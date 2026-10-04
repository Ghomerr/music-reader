import { describe, expect, test } from 'vitest';
import { readMusicXml } from './musicxml-read';
import { hasJobs, jobXml, RAINBOW } from './test-data';

/** MusicXML minimal : parts = [[nom, contenu des mesures]] */
function doc(parts: [string, string][], head = ''): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">${head}
  <part-list>${parts.map(([n], i) => `<score-part id="P${i + 1}"><part-name>${n}</part-name></score-part>`).join('')}</part-list>
  ${parts.map(([, m], i) => `<part id="P${i + 1}">${m}</part>`).join('\n')}
</score-partwise>`;
}
const note = (step: string, oct: number, dur: number, extra = '') =>
  `<note><pitch><step>${step}</step><octave>${oct}</octave></pitch><duration>${dur}</duration>${extra}</note>`;
const rest = (dur: number, extra = '') => `<note><rest/><duration>${dur}</duration>${extra}</note>`;

describe('readMusicXml — cas construits', () => {
  test('divisions, accords, backup/forward, ornements, voix renumérotées', () => {
    const s = readMusicXml(doc([['Piano', `
      <measure number="1">
        <attributes><divisions>2</divisions><staves>2</staves><time><beats>3</beats><beat-type>4</beat-type></time>
          <clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
        <note><grace/><pitch><step>D</step><octave>5</octave></pitch><voice>1</voice><staff>1</staff></note>
        ${note('C', 5, 2, '<voice>1</voice><staff>1</staff>')}
        ${note('E', 5, 2, '<chord/><voice>1</voice><staff>1</staff>')}
        ${note('D', 5, 4, '<voice>1</voice><staff>1</staff>')}
        <backup><duration>6</duration></backup>
        <forward><duration>2</duration></forward>
        ${note('G', 4, 1, '<voice>2</voice><staff>1</staff>')}
        <backup><duration>3</duration></backup>
        ${note('C', 3, 6, '<voice>5</voice><staff>2</staff>')}
      </measure>`]]));
    expect(s.staves).toEqual([2]);
    expect(s.lines.map(l => [l.id, l.name, l.clef.sign])).toEqual([['0|1', 'Piano — portée 1', 'G'], ['0|2', 'Piano — portée 2', 'F']]);
    const [up, down] = s.lines;
    expect(up.notes.map(n => [n.offset, n.duration, n.pitch?.step, n.voice])).toEqual([
      [0, 1, 'C', 1], [0, 1, 'E', 1], [1, 2, 'D', 1], [1, 0.5, 'G', 2],
    ]);
    expect(down.notes.map(n => [n.offset, n.duration, n.voice])).toEqual([[0, 3, 1]]);
    expect(s.measures[0]).toMatchObject({ local: 0, label: '1', beats: 3, beatType: 4, fifths: 0, mode: 'major' });
    expect(s.hasTime).toBe(true);
    expect(s.hasKey).toBe(false);
  });

  test('silences, mesure entière, durée nulle, liaisons, paroles, percussion', () => {
    const s = readMusicXml(doc([['Chant', `
      <measure number="1"><attributes><divisions>1</divisions><key><fifths>-3</fifths><mode>minor</mode></key></attributes>
        ${note('E', 4, 2, `<tie type="start"/><voice>1</voice>
          <lyric number="1"><syllabic>begin</syllabic><text>Là</text></lyric>
          <lyric number="2"><text>l'a</text><elision/><text>mour</text></lyric>
          <lyric number="3"><extend/></lyric>`)}
        ${note('E', 4, 2, '<tie type="stop"/><voice>1</voice>')}
        ${note('F', 4, 0, '<voice>1</voice>')}
        <note><unpitched><display-step>E</display-step><display-octave>4</display-octave></unpitched><duration>1</duration></note>
      </measure>
      <measure number="2"><note><rest measure="yes"/><duration>4</duration><voice>1</voice></note></measure>
      <measure number="3" implicit="yes">${rest(1)}${note('B', 4, 1, '<voice>3</voice>')}</measure>`]]));
    const n = s.lines[0].notes;
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0].name).toBe('Chant');
    expect(n[0]).toMatchObject({ measure: 0, offset: 0, duration: 2, pitch: { step: 'E', alter: 0, octave: 4 }, tie: true });
    expect(n[0].lyrics).toEqual([{ verse: 1, text: 'Là', syllabic: 'begin' }, { verse: 2, text: 'l\'a‿mour' }]);
    expect(n[1].tie).toBeUndefined();
    expect(n[2]).toMatchObject({ offset: 4, duration: 0 });           // conservée pour le contrôle
    expect(n).toHaveLength(6);                                          // percussion ignorée
    expect(n[3]).toMatchObject({ measure: 1, offset: 0, duration: 4, pitch: null });
    expect(n[5]).toMatchObject({ measure: 2, offset: 1, voice: 2 });    // voix 3 → 2e voix de la ligne
    expect(s.measures.map(m => [m.label, m.fifths, m.mode, m.beats])).toEqual([['1', -3, 'minor', 4], ['2', -3, 'minor', 4], ['3', -3, 'minor', 4]]);
    expect(s.hasKey).toBe(true);
    expect(s.hasTime).toBe(false);
    expect(new Set(s.lines[0].notes.map(x => x.id)).size).toBe(6);
  });

  test('métrique héritée, changement de clé, sauts de système, tri par voix', () => {
    const s = readMusicXml(doc([['A', `
      <measure number="1"><attributes><divisions>1</divisions><time><beats>2</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
        ${note('C', 4, 2, '<voice>2</voice>')}<backup><duration>2</duration></backup>${note('E', 5, 2, '<voice>1</voice>')}</measure>
      <measure number="2"><print new-system="yes"/>${note('C', 4, 1)}<attributes><clef><sign>F</sign><line>4</line></clef></attributes>${note('C', 3, 1)}</measure>
      <measure number="3"><print new-page="yes"/><attributes><time><beats>6</beats><beat-type>8</beat-type></time></attributes>${note('C', 3, 3)}</measure>
      <measure number="4">${note('C', 3, 3)}</measure>`]]));
    const l = s.lines[0];
    expect(l.notes.slice(0, 2).map(n => n.pitch?.octave)).toEqual([4, 5]); // voix 2 (vue d'abord) = voix 1
    expect(l.clef).toEqual({ sign: 'G', line: 2 });
    expect(l.clefChanges).toEqual([{ measure: 1, offset: 1, clef: { sign: 'F', line: 4 } }]);
    expect(s.measures.map(m => `${m.beats}/${m.beatType}`)).toEqual(['2/4', '2/4', '6/8', '6/8']);
    expect(s.measures[1].newSystem).toBe(true);
    expect(s.measures[2].newPage).toBe(true);
    expect(s.measures[0].newSystem).toBeUndefined();
  });

  test('titre : work-title, movement-title, sinon le plus grand texte du haut de page', () => {
    const body: [string, string][] = [['A', '<measure number="1"/>']];
    expect(readMusicXml(doc(body, '<work><work-title>Œuvre</work-title></work><movement-title>Mvt</movement-title>')).title).toBe('Œuvre');
    expect(readMusicXml(doc(body, '<movement-title>Mvt</movement-title>')).title).toBe('Mvt');
    expect(readMusicXml(doc(body, `<defaults><page-layout><page-height>1000</page-height></page-layout></defaults>
      <credit page="1"><credit-words default-y="950" font-size="10">Petit titre</credit-words></credit>
      <credit page="1"><credit-words default-y="900" font-size="14">Grand Titre</credit-words></credit>
      <credit page="1"><credit-words default-y="950" font-size="20">33</credit-words></credit>
      <credit page="1"><credit-words default-y="300" font-size="20">Au milieu</credit-words></credit>`)).title).toBe('Grand Titre');
    expect(readMusicXml(doc(body)).title).toBe('');
  });

  test('erreurs en français', () => {
    expect(() => readMusicXml('<score-partwise><part>')).toThrow(/XML valide/);
    expect(() => readMusicXml('<score-timewise version="4.0"/>')).toThrow(/score-timewise/);
  });
});

describe.skipIf(!hasJobs)('readMusicXml — Over The Rainbow (v0/jobs)', () => {
  test('page 1 : 17 mesures, 2 parties, 3 portées, 259 notes dont 15 rondes', () => {
    const s = readMusicXml(jobXml(RAINBOW.p1));
    expect(s.title).toBe('Over The Rainbow');
    expect(s.measures).toHaveLength(17);
    expect(s.staves).toEqual([1, 2]);
    expect(s.lines.map(l => `${l.id} ${l.name} ${l.clef.sign}`)).toEqual(['0|1 Voice G', '1|1 Piano — portée 1 G', '1|2 Piano — portée 2 F']);
    const notes = s.lines.flatMap(l => l.notes);
    expect(notes.filter(n => n.pitch)).toHaveLength(259);
    expect(notes.filter(n => n.pitch && n.duration === 4)).toHaveLength(15);
    expect(s.hasTime).toBe(true);
    expect(s.measures.every(m => m.beats === 4 && m.beatType === 4)).toBe(true);
    // 4 systèmes : sauts avant les mesures 5, 9 et 14
    expect(s.measures.filter(m => m.newSystem).map(m => m.label)).toEqual(['5', '9', '14']);
    expect(s.lines[0].notes.filter(n => n.lyrics?.length).length).toBeGreaterThan(40);
    for (const l of s.lines) {
      const sorted = [...l.notes].sort((a, b) => a.measure - b.measure || a.offset - b.offset || a.voice - b.voice);
      expect(l.notes).toEqual(sorted);
    }
  });

  test('pages 2 et 3 : 15 et 8 mesures, métrique non réimprimée, liaisons', () => {
    const p2 = readMusicXml(jobXml(RAINBOW.p2)), p3 = readMusicXml(jobXml(RAINBOW.p3));
    expect([p2.measures.length, p3.measures.length]).toEqual([15, 8]);
    expect([p2.hasTime, p3.hasTime]).toEqual([false, false]);
    expect(p2.lines.map(l => l.id)).toEqual(['0|1', '1|1', '1|2']);
    expect(p2.lines.flatMap(l => l.notes).filter(n => n.tie)).toHaveLength(1);
    expect(p3.lines.flatMap(l => l.notes).filter(n => n.tie)).toHaveLength(2);
    // mesures 1 à 3 de la page 3 : pause de mesure entière dans le chant
    expect(p3.lines[0].notes.filter(n => n.measure < 3).map(n => [n.offset, n.duration, n.pitch])).toEqual([[0, 4, null], [0, 4, null], [0, 4, null]]);
  });
});

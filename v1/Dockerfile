# Music Reader v1 — image de production : interface construite + serveur Node + Audiveris 5.11 (Linux).
# NON TESTÉ (Docker indisponible sur le poste de développement) : à valider au premier déploiement.
#   docker build -t music-reader .                     (depuis v1/ : c'est le contexte de construction)
#   docker build --build-arg AUDIVERIS_HEAP=320m ...   (petite instance de 512 Mo)
#   docker run --rm -p 8787:8787 music-reader      puis http://localhost:8787
# Prévoir 1 à 2 Go de mémoire : Audiveris est une application Java. Render : voir render.yaml à la racine.

# ---------- 1. Interface (Vite) ----------
FROM node:20-bookworm-slim AS front
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json ./
COPY public ./public
COPY src ./src
# tsc -b vérifie aussi les tests, dont l'un lit le découpage des pages avec server/omr.mjs
COPY server ./server
RUN npm run build

# ---------- 2. Exécution : Ubuntu 24.04 (paquet officiel d'Audiveris) + Node 20 ----------
FROM ubuntu:24.04
ARG AUDIVERIS_VERSION=5.11.0
# Mémoire maximale de Java pour Audiveris. Son lanceur impose -Xms512m -Xmx8G : 512 Mo réservés d'office
# suffisent à faire tuer le conteneur sur une petite instance. On les remplace : -Xms64m et ce plafond,
# à adapter à la mémoire de l'instance (laisser ~150 Mo à Node et à la JVM hors tas). 1 à 2 Go conseillés.
ARG AUDIVERIS_HEAP=1g
ENV DEBIAN_FRONTEND=noninteractive

# Le paquet .deb n'est pas installé par dpkg mais décompressé tel quel : son script de post-installation ne
# fait qu'intégrer Audiveris au bureau (menu, type de fichier, via xdg-utils) et échoue dans un conteneur sans
# bureau (« xdg-desktop-menu: No writable system menu directory found »). On installe donc ses dépendances,
# sauf xdg-utils, puis ses fichiers : lanceur /opt/audiveris/bin/Audiveris, Java embarqué.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl fontconfig \
 && curl -fsSL -o /tmp/audiveris.deb \
      "https://github.com/Audiveris/audiveris/releases/download/${AUDIVERIS_VERSION}/Audiveris-${AUDIVERIS_VERSION}-ubuntu24.04-x86_64.deb" \
 && DEPS="$(dpkg-deb -f /tmp/audiveris.deb Depends | sed -e 's/([^)]*)//g' -e 's/|[^,]*//g' | tr ',' '\n' | tr -d ' ' | grep -v -e '^xdg-utils$' -e '^$')" \
 && apt-get install -y --no-install-recommends $DEPS \
 && dpkg-deb -x /tmp/audiveris.deb / \
 && test -x /opt/audiveris/bin/Audiveris \
 # options Java du lanceur (fichier .cfg de jpackage) : mémoire réglée par AUDIVERIS_HEAP
 && CFG=/opt/audiveris/lib/app/Audiveris.cfg \
 && test -f "$CFG" \
 # (on retire les -Xms/-Xmx existants, puis on insère les nôtres sous [JavaOptions], créée au besoin)
 && sed -i -e '/^java-options=-Xm[sx]/d' "$CFG" \
 && { grep -q '^\[JavaOptions\]' "$CFG" || printf '[JavaOptions]\n' >> "$CFG"; } \
 && sed -i "/^\[JavaOptions\]/a java-options=-Xms64m\njava-options=-Xmx${AUDIVERIS_HEAP}" "$CFG" \
 && grep -E '^java-options=-Xm' "$CFG" \
 && rm -f /tmp/audiveris.deb \
 && rm -rf /var/lib/apt/lists/*

# Modèles OCR « standard » (Audiveris utilise le mode legacy de Tesseract, absent des modèles « fast »)
RUN mkdir -p /opt/tessdata \
 && for l in eng fra ita; do \
      curl -fsSL -o /opt/tessdata/$l.traineddata "https://github.com/tesseract-ocr/tessdata/raw/main/$l.traineddata"; \
    done

# Node 20 repris de l'image officielle (binaire seul : le serveur n'a aucune dépendance npm)
COPY --from=front /usr/local/bin/node /usr/local/bin/node

WORKDIR /app
COPY server ./server
COPY --from=front /app/dist ./dist

RUN useradd --create-home --uid 10001 music && mkdir -p /tmp/music-reader-jobs && chown music /tmp/music-reader-jobs
USER music

ENV HOST=0.0.0.0 \
    PORT=8787 \
    AUDIVERIS_CMD=/opt/audiveris/bin/Audiveris \
    TESSDATA_PREFIX=/opt/tessdata \
    JOBS_DIR=/tmp/music-reader-jobs \
    JAVA_TOOL_OPTIONS=-Djava.awt.headless=true
EXPOSE 8787
HEALTHCHECK --interval=60s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/server.mjs"]

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
RUN npm run build

# ---------- 2. Exécution : Ubuntu 24.04 (paquet officiel d'Audiveris) + Node 20 ----------
FROM ubuntu:24.04
ARG AUDIVERIS_VERSION=5.11.0
# Mémoire maximale de Java pour Audiveris. Son lanceur impose -Xms512m -Xmx8G : 512 Mo réservés d'office
# suffisent à faire tuer le conteneur sur une petite instance. On les remplace : -Xms64m et ce plafond,
# à adapter à la mémoire de l'instance (laisser ~150 Mo à Node et à la JVM hors tas). 1 à 2 Go conseillés.
ARG AUDIVERIS_HEAP=1g
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl fontconfig \
 && curl -fsSL -o /tmp/audiveris.deb \
      "https://github.com/Audiveris/audiveris/releases/download/${AUDIVERIS_VERSION}/Audiveris-${AUDIVERIS_VERSION}-ubuntu24.04-x86_64.deb" \
 && apt-get install -y --no-install-recommends /tmp/audiveris.deb \
 && PKG="$(dpkg-deb -f /tmp/audiveris.deb Package)" \
 # le chemin d'installation dépend du paquet : on retrouve le lanceur et on le publie sous un nom fixe
 && AUD="$(dpkg -L "$PKG" | grep -E '/bin/[Aa]udiveris$' | head -n 1)" \
 && test -n "$AUD" && ln -s "$AUD" /usr/local/bin/audiveris \
 # options Java du lanceur (fichier .cfg de jpackage) : mémoire réglée par AUDIVERIS_HEAP
 && CFG="$(dpkg -L "$PKG" | grep -E '/Audiveris\.cfg$' | head -n 1)" \
 && test -n "$CFG" \
 && sed -i -e 's/^java-options=-Xms.*/java-options=-Xms64m/' -e "s/^java-options=-Xmx.*/java-options=-Xmx${AUDIVERIS_HEAP}/" "$CFG" \
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
    AUDIVERIS_CMD=/usr/local/bin/audiveris \
    TESSDATA_PREFIX=/opt/tessdata \
    JOBS_DIR=/tmp/music-reader-jobs \
    JAVA_TOOL_OPTIONS=-Djava.awt.headless=true
EXPOSE 8787
HEALTHCHECK --interval=60s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/server.mjs"]

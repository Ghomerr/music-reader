// Couleur d'une ligne musicale, par rang dans project.lines (palette de la v0). Partagée avec la partition
// pour que la pastille du panneau d'écoute et les notes surlignées se répondent.
export const LINE_COLORS = ['#4f46e5', '#0e9f6e', '#d9480f', '#b5179e', '#0284c7', '#a16207', '#64748b', '#dc2626'];

export const lineColor = (rank: number): string => LINE_COLORS[((rank % LINE_COLORS.length) + LINE_COLORS.length) % LINE_COLORS.length];

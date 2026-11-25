const dos = (n: number) => String(n).padStart(2, '0');

/** Fecha/hora local en formato ISO sin zona: "2026-11-25T06:52:00". */
export function isoLocal(d: Date = new Date()): string {
  return (
    `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}` +
    `T${dos(d.getHours())}:${dos(d.getMinutes())}:${dos(d.getSeconds())}`
  );
}

/** "2026-11" a partir de una fecha ISO o de un Date. */
export function claveMes(fecha: string | Date = new Date()): string {
  if (typeof fecha === 'string') return fecha.substring(0, 7);
  return `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}`;
}

/** Suma (o resta) meses a una clave "YYYY-MM". */
export function moverMes(clave: string, delta: number): string {
  const [a, m] = clave.split('-').map(Number);
  const d = new Date(a, m - 1 + delta, 1);
  return claveMes(d);
}

/** "Noviembre 2026" */
export function nombreMes(clave: string): string {
  const [a, m] = clave.split('-').map(Number);
  const texto = new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric' }).format(
    new Date(a, m - 1, 1),
  );
  return texto.charAt(0).toUpperCase() + texto.slice(1).replace(' de ', ' ');
}

/** "25 nov 2026" */
export function fechaCorta(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
}

/** Marca de tiempo compacta para nombres de archivo: 20261125_173253 */
export function marcaArchivo(d: Date = new Date()): string {
  return (
    `${d.getFullYear()}${dos(d.getMonth() + 1)}${dos(d.getDate())}_` +
    `${dos(d.getHours())}${dos(d.getMinutes())}${dos(d.getSeconds())}`
  );
}

/**
 * Reglas de dinero de la app:
 *  - Los montos SIEMPRE son pesos enteros (number sin decimales).
 *  - Nunca se guardan textos formateados ("1.500.000") en el estado.
 *  - Toda entrada (teclado, pegado, OCR, almacenamiento) pasa por aPesosEnteros().
 */
export const MONTO_MAXIMO = 999_999_999_999; // 999 mil millones

/** Convierte lo que llegue (texto pegado, número, OCR) en pesos enteros > 0, o null. */
export function aPesosEnteros(valor: unknown): number | null {
  if (typeof valor === 'number') {
    return Number.isFinite(valor) && valor >= 1 ? Math.min(Math.round(valor), MONTO_MAXIMO) : null;
  }
  if (typeof valor !== 'string') return null;
  let t = valor.trim();
  if (/^[^\d]*-/.test(t)) return null; // montos negativos ("-5", "$ -5") no se aceptan
  // Decimales explícitos: solo se descartan si son inequívocos, para no romper la escritura
  // en curso (al borrar "15.000" queda "15.00", que son miles, no decimales).
  const tienePunto = t.includes('.');
  const tieneComa = t.includes(',');
  if (tienePunto && tieneComa) {
    t = t.replace(/[.,]\d{1,2}$/, ''); // "45.900,00" o "45,900.00"
  } else if (tieneComa && !tienePunto) {
    t = t.replace(/,\d{1,2}$/, ''); // "12,50" (coma decimal colombiana)
  }
  const sinDecimales = t;
  const soloDigitos = sinDecimales.replace(/\D/g, ''); // quita $, puntos, comas, espacios, signo menos y letras
  if (!soloDigitos) return null;
  const n = Number(soloDigitos.slice(0, 15));
  return n >= 1 ? Math.min(n, MONTO_MAXIMO) : null;
}

/** 1500000 → "1.500.000" (sin símbolo, para mostrar dentro de un campo). */
export function conMiles(n: number | null | undefined): string {
  return n == null ? '' : new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(n);
}

/** Suma segura de montos enteros (ignora valores no numéricos). */
export function sumarPesos(valores: readonly unknown[]): number {
  let total = 0;
  for (const v of valores) {
    if (typeof v === 'number' && Number.isFinite(v)) total += Math.round(v);
  }
  return total;
}

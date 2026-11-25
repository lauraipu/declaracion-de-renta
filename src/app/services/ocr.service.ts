import { Injectable, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Script, TextRecognition } from '@capacitor-mlkit/text-recognition';

import { ArchivosService } from './archivos.service';

export interface DatosRecibo {
  monto?: number;
  fecha?: string; // "YYYY-MM-DD"
  comercio?: string;
}

/**
 * Lectura automática del recibo (OCR) con Google ML Kit, en el propio celular.
 * Solo funciona en Android/iOS: en el navegador `disponible` es false.
 */
@Injectable({ providedIn: 'root' })
export class OcrService {
  private readonly archivos = inject(ArchivosService);

  readonly disponible = Capacitor.isNativePlatform();

  async leerRecibo(nombreArchivo: string): Promise<DatosRecibo | null> {
    if (!this.disponible || this.archivos.esPdf(nombreArchivo)) return null;
    const path = await this.archivos.obtenerUriNativa(nombreArchivo);
    const { text } = await TextRecognition.processImage({ path, script: Script.Latin });
    return interpretarTextoRecibo(text);
  }
}

// ---------------------------------------------------------------------------
// Interpretación del texto (funciones puras, fáciles de probar)
// ---------------------------------------------------------------------------

const PALABRAS_TOTAL = /(total\s*a\s*pagar|valor\s*a\s*pagar|valor\s*total|total|neto\s*a\s*pagar|vr\.?\s*total)/i;
const NUMERO_DINERO = /\$?\s*\d{1,3}(?:[.,\s]\d{3})+(?:[.,]\d{1,2})?|\$\s*\d+(?:[.,]\d{1,2})?|\b\d{4,9}(?:[.,]\d{1,2})?\b/g;

export function interpretarTextoRecibo(texto: string): DatosRecibo {
  const lineas = texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return {
    monto: buscarMonto(lineas),
    fecha: buscarFecha(lineas.join('\n')),
    comercio: buscarComercio(lineas),
  };
}

/** "45.900" → 45900 · "45,900.00" → 45900 · "$ 1.234.567,50" → 1234567.5 */
export function convertirNumero(crudo: string): number | undefined {
  const s = crudo.replace(/[$\s]/g, '');
  if (!/\d/.test(s)) return undefined;
  const ultimoPunto = s.lastIndexOf('.');
  const ultimaComa = s.lastIndexOf(',');
  let normal: string;
  if (ultimoPunto >= 0 && ultimaComa >= 0) {
    const dec = ultimoPunto > ultimaComa ? '.' : ',';
    const mil = dec === '.' ? ',' : '.';
    normal = s.split(mil).join('').replace(dec, '.');
  } else if (ultimoPunto >= 0 || ultimaComa >= 0) {
    const sep = ultimoPunto >= 0 ? '.' : ',';
    const partes = s.split(sep);
    const ultima = partes[partes.length - 1];
    normal = partes.length === 2 && ultima.length <= 2 ? partes.join('.') : partes.join('');
  } else {
    normal = s;
  }
  const n = Math.round(Number(normal)); // los montos de la app son pesos enteros
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function numerosEn(linea: string): number[] {
  return (linea.match(NUMERO_DINERO) ?? [])
    .map(convertirNumero)
    .filter((n): n is number => n !== undefined);
}

function buscarMonto(lineas: string[]): number | undefined {
  // 1) Líneas con "TOTAL" (de abajo hacia arriba, sin "subtotal")
  for (let i = lineas.length - 1; i >= 0; i--) {
    const l = lineas[i];
    if (PALABRAS_TOTAL.test(l) && !/sub\s*total/i.test(l)) {
      const enLinea = numerosEn(l);
      if (enLinea.length) return Math.max(...enLinea);
      const siguiente = lineas[i + 1] ? numerosEn(lineas[i + 1]) : [];
      if (siguiente.length) return Math.max(...siguiente);
    }
  }
  // 2) Si no hay "TOTAL", el valor con formato de dinero más alto
  const candidatos = lineas
    .filter((l) => /\$|\d{1,3}[.,]\d{3}/.test(l) && !/nit|tel|cel|c\.?c\.?|resoluci/i.test(l))
    .flatMap(numerosEn)
    .filter((n) => n < 100_000_000);
  return candidatos.length ? Math.max(...candidatos) : undefined;
}

function buscarFecha(texto: string): string | undefined {
  const dos = (n: number) => String(n).padStart(2, '0');
  const valida = (a: number, m: number, d: number) => {
    if (a < 100) a += 2000;
    const f = new Date(a, m - 1, d);
    const hoy = new Date();
    if (f.getMonth() !== m - 1 || a < hoy.getFullYear() - 5 || f > new Date(hoy.getTime() + 86_400_000)) {
      return undefined;
    }
    return `${a}-${dos(m)}-${dos(d)}`;
  };
  // AAAA-MM-DD
  for (const r of texto.matchAll(/\b(20\d{2})[\/\-.](\d{1,2})[\/\-.](\d{1,2})\b/g)) {
    const f = valida(+r[1], +r[2], +r[3]);
    if (f) return f;
  }
  // DD/MM/AAAA (formato colombiano)
  for (const r of texto.matchAll(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/g)) {
    const f = valida(+r[3], +r[2], +r[1]);
    if (f) return f;
  }
  return undefined;
}

function buscarComercio(lineas: string[]): string | undefined {
  const linea = lineas
    .slice(0, 6)
    .find(
      (l) =>
        (l.match(/[a-záéíóúñ]/gi) ?? []).length >= 3 &&
        !/factura|nit|fecha|tel|direcci|r[eé]gimen|resoluci|www|@/i.test(l),
    );
  if (!linea) return undefined;
  return linea
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/(^|\s)\S/g, (c) => c.toUpperCase())
    .substring(0, 60);
}

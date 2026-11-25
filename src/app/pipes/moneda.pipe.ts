import { Pipe, PipeTransform } from '@angular/core';

const formatos = new Map<string, Intl.NumberFormat>();

export function formatearMoneda(valor: number | null | undefined, moneda = 'COP'): string {
  let f = formatos.get(moneda);
  if (!f) {
    f = new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: moneda,
      maximumFractionDigits: moneda === 'COP' ? 0 : 2,
    });
    formatos.set(moneda, f);
  }
  return f.format(valor ?? 0);
}

@Pipe({ name: 'moneda' })
export class MonedaPipe implements PipeTransform {
  transform(valor: number | null | undefined, moneda = 'COP'): string {
    return formatearMoneda(valor, moneda);
  }
}

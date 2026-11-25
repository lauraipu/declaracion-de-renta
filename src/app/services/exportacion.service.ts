import { Injectable, inject } from '@angular/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

import { fechaCorta } from '../models/fechas';
import {
  ConfiguracionUsuario,
  GastoItem,
  TIPOS_DEDUCIBLES,
  etiquetaCategoria,
  etiquetaDeducible,
} from '../models/gasto.model';
import { sumarPesos } from '../utils/dinero';
import { ArchivosService, esCancelacion } from './archivos.service';

export type ResultadoExportacion = 'compartido' | 'descargado' | 'cancelado';

/** Genera el CSV anual y lo comparte (con las fotos de los soportes). */
@Injectable({ providedIn: 'root' })
export class ExportacionService {
  private readonly archivos = inject(ArchivosService);

  generarCsv(gastos: GastoItem[], anio: number, config: ConfiguracionUsuario): string {
    const sep = ';'; // Excel en español usa punto y coma
    const fila = (valores: (string | number)[]) => valores.map(celda).join(sep);

    const lineas: string[] = [
      fila([`Paquete de soportes para declaración de renta — Año gravable ${anio}`]),
      fila([`Moneda: ${config.moneda}`, `Generado: ${new Date().toLocaleString('es-CO')}`]),
      '',
      fila([
        'Fecha',
        'Comercio',
        'Título',
        'Descripción',
        'Categoría',
        'Monto',
        'Deducible renta',
        'Tipo de soporte',
        'Tiene soporte',
        'Archivo del soporte',
      ]),
      ...gastos.map((g) =>
        fila([
          g.fecha.substring(0, 10),
          g.comercio,
          g.titulo ?? '',
          g.descripcion ?? '',
          etiquetaCategoria(g.categoria),
          g.monto,
          g.esDeducibleRenta ? 'Sí' : 'No',
          etiquetaDeducible(g.tipoDeducible),
          g.tieneSoporte ? 'Sí' : 'No',
          g.fotoNombreArchivo ?? '',
        ]),
      ),
      '',
      fila(['RESUMEN POR RUBRO TRIBUTARIO']),
      fila(['Rubro', 'Cantidad', 'Total', 'Tope referencial']),
    ];

    for (const t of TIPOS_DEDUCIBLES) {
      const delTipo = gastos.filter((g) => g.esDeducibleRenta && g.tipoDeducible === t.valor);
      if (!delTipo.length) continue;
      lineas.push(
        fila([
          t.etiqueta,
          delTipo.length,
          sumarPesos(delTipo.map((g) => g.monto)),
          config.topesDeducibles?.[t.valor] ?? '',
        ]),
      );
    }
    const total = sumarPesos(gastos.filter((g) => g.esDeducibleRenta).map((g) => g.monto));
    lineas.push(fila(['TOTAL DEDUCIBLE', '', total, '']));
    return '﻿' + lineas.join('\r\n'); // BOM para que Excel lea bien las tildes
  }

  async exportarAnual(
    gastos: GastoItem[],
    anio: number,
    config: ConfiguracionUsuario,
  ): Promise<ResultadoExportacion> {
    const csv = this.generarCsv(gastos, anio, config);
    const nombre = `renta_${anio}_soportes.csv`;

    if (!this.archivos.esNativo) {
      descargarEnNavegador(csv, nombre);
      return 'descargado';
    }

    const { uri } = await Filesystem.writeFile({
      path: nombre,
      data: csv,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
    const fotos = await Promise.all(
      gastos
        .filter((g) => g.fotoNombreArchivo)
        .map((g) => this.archivos.obtenerUriNativa(g.fotoNombreArchivo!)),
    );

    try {
      await Share.share({
        title: `Soportes renta ${anio}`,
        text:
          `Hola, te comparto el resumen de gastos y soportes para la declaración de renta ${anio}.` +
          (config.correoContador ? `\nPara: ${config.correoContador}` : ''),
        files: [uri, ...fotos],
        dialogTitle: 'Enviar paquete al contador',
      });
      return 'compartido';
    } catch (e) {
      if (esCancelacion(e)) return 'cancelado';
      throw e;
    }
  }

  /** Comparte una sola imagen de recibo. */
  async compartirRecibo(gasto: GastoItem): Promise<ResultadoExportacion> {
    if (!gasto.fotoNombreArchivo) return 'cancelado';
    if (!this.archivos.esNativo) {
      const url = await this.archivos.obtenerUrl(gasto.fotoNombreArchivo);
      const a = document.createElement('a');
      a.href = url;
      a.download = gasto.fotoNombreArchivo;
      a.click();
      return 'descargado';
    }
    try {
      await Share.share({
        title: `Recibo ${gasto.comercio}`,
        text: `${gasto.comercio} · ${fechaCorta(gasto.fecha)}`,
        files: [await this.archivos.obtenerUriNativa(gasto.fotoNombreArchivo)],
        dialogTitle: 'Compartir recibo',
      });
      return 'compartido';
    } catch (e) {
      if (esCancelacion(e)) return 'cancelado';
      throw e;
    }
  }
}

function celda(v: string | number): string {
  // Números: siempre pesos enteros, sin separadores (Excel en español no confunde decimales)
  let s = typeof v === 'number' ? String(Math.round(v)) : String(v);
  // Evita inyección de fórmulas en Excel (CSV Injection): =, +, -, @, tab y retorno de carro
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function descargarEnNavegador(contenido: string, nombre: string): void {
  const blob = new Blob([contenido], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

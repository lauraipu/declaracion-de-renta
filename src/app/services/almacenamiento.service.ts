import { Injectable, computed, inject, signal } from '@angular/core';
import { Preferences } from '@capacitor/preferences';

import { claveMes, isoLocal } from '../models/fechas';
import {
  CATEGORIAS,
  CONFIG_POR_DEFECTO,
  CategoriaGasto,
  ConfiguracionUsuario,
  GastoItem,
  TIPOS_DEDUCIBLES,
  TipoDeducible,
} from '../models/gasto.model';
import { mesHoy } from '../models/reloj';
import { aPesosEnteros, sumarPesos } from '../utils/dinero';
import { ArchivosService } from './archivos.service';

const CLAVE_GASTOS = 'gastos_v1';
const CLAVE_CONFIG = 'configuracion_v1';

export type DatosNuevoGasto = Omit<GastoItem, 'id' | 'anioFiscal' | 'mesFiscal' | 'tieneSoporte' | 'creadoEn'> & {
  id?: string;
  creadoEn?: string;
};

/**
 * CRUD de gastos y configuración con @capacitor/preferences.
 * - Todas las escrituras esperan la carga inicial y se ejecutan en fila (sin carreras).
 * - Lo que se lee del disco se valida y sanea; si viene dañado se respalda antes de tocarlo.
 */
@Injectable({ providedIn: 'root' })
export class AlmacenamientoService {
  private readonly archivos = inject(ArchivosService);

  /** Todos los gastos, del más reciente al más antiguo. */
  readonly gastos = signal<GastoItem[]>([]);
  readonly config = signal<ConfiguracionUsuario>({ ...CONFIG_POR_DEFECTO });
  /** true si los datos guardados no se pudieron leer completos (se respaldaron). */
  readonly errorCarga = signal(false);

  /** Total gastado en el mes calendario actual (se actualiza solo al cambiar de mes). */
  readonly gastadoMesActual = computed(() => this.totalMes(mesHoy()));
  /** Porcentaje (0-∞) del presupuesto usado en el mes actual; 0 si no hay tope. */
  readonly porcentajeMesActual = computed(() => {
    const tope = this.config().presupuestoMensual;
    return tope > 0 ? (this.gastadoMesActual() / tope) * 100 : 0;
  });

  private readonly carga: Promise<void>;
  private cola: Promise<unknown> = Promise.resolve();
  /** Si ni siquiera se pudo leer el almacenamiento, no se escribe para no pisar datos. */
  private escrituraBloqueada = false;

  constructor() {
    this.carga = this.cargar();
    void this.carga.then(async () => {
      if (!this.errorCarga() && !this.escrituraBloqueada) {
        await this.archivos.limpiarHuerfanos(this.nombresEnUso());
      }
    });
  }

  /** Resuelve cuando los datos guardados ya están en memoria (nunca rechaza). */
  listo(): Promise<void> {
    return this.carga;
  }

  totalMes(mes: string): number {
    return sumarPesos(this.gastos().filter((g) => g.mesFiscal === mes).map((g) => g.monto));
  }

  obtener(id: string): GastoItem | undefined {
    return this.gastos().find((g) => g.id === id);
  }

  /** Construye un GastoItem completo calculando los campos derivados. */
  construirGasto(datos: DatosNuevoGasto): GastoItem {
    const fecha = normalizarFecha(datos.fecha) ?? isoLocal();
    return {
      ...datos,
      id: datos.id ?? generarId(),
      monto: aPesosEnteros(datos.monto) ?? 0,
      fecha,
      anioFiscal: Number(fecha.substring(0, 4)),
      mesFiscal: claveMes(fecha),
      tipoDeducible: datos.esDeducibleRenta ? datos.tipoDeducible : undefined,
      tieneSoporte: !!datos.fotoNombreArchivo,
      creadoEn: datos.creadoEn ?? isoLocal(),
    };
  }

  /** Crea o actualiza (por id) un gasto. Llamarlo dos veces con el mismo id no duplica. */
  guardarGasto(gasto: GastoItem): Promise<void> {
    return this.enCola(async () => {
      const lista = this.gastos().filter((g) => g.id !== gasto.id);
      lista.push(gasto);
      this.gastos.set(ordenar(lista));
      await this.persistirGastos();
    });
  }

  /** Quita el gasto de la lista (no borra la foto: eso lo decide quien llama). */
  eliminarGasto(id: string): Promise<GastoItem | undefined> {
    return this.enCola(async () => {
      const eliminado = this.obtener(id);
      if (!eliminado) return undefined;
      this.gastos.set(this.gastos().filter((g) => g.id !== id));
      await this.persistirGastos();
      return eliminado;
    });
  }

  guardarConfig(cambios: Partial<ConfiguracionUsuario>): Promise<void> {
    return this.enCola(async () => {
      const nueva = sanearConfig({ ...this.config(), ...cambios });
      this.config.set(nueva);
      await Preferences.set({ key: CLAVE_CONFIG, value: JSON.stringify(nueva) });
    });
  }

  nombresEnUso(): Set<string> {
    return new Set(this.gastos().flatMap((g) => (g.fotoNombreArchivo ? [g.fotoNombreArchivo] : [])));
  }

  // ===================== Internos =====================

  /** Ejecuta mutaciones una detrás de otra y siempre después de la carga inicial. */
  private enCola<T>(tarea: () => Promise<T>): Promise<T> {
    const resultado = this.cola
      .then(() => this.carga)
      .then(() => {
        if (this.escrituraBloqueada) throw new Error('Almacenamiento no disponible');
        return tarea();
      });
    this.cola = resultado.catch(() => undefined); // un fallo no bloquea la fila
    return resultado;
  }

  private async cargar(): Promise<void> {
    let crudoGastos: string | null;
    let crudoConfig: string | null;
    try {
      [crudoGastos, crudoConfig] = await Promise.all([
        Preferences.get({ key: CLAVE_GASTOS }).then((r) => r.value),
        Preferences.get({ key: CLAVE_CONFIG }).then((r) => r.value),
      ]);
    } catch {
      this.errorCarga.set(true);
      this.escrituraBloqueada = true;
      return;
    }

    if (crudoGastos) {
      try {
        const lista: unknown = JSON.parse(crudoGastos);
        if (!Array.isArray(lista)) throw new Error('formato inválido');
        const sanos = lista.map(sanearGasto).filter((g): g is GastoItem => g !== null);
        if (sanos.length !== lista.length) {
          await this.respaldar(CLAVE_GASTOS, crudoGastos);
          this.errorCarga.set(true);
        }
        this.gastos.set(ordenar(sanos));
      } catch {
        await this.respaldar(CLAVE_GASTOS, crudoGastos);
        this.errorCarga.set(true);
      }
    }

    if (crudoConfig) {
      try {
        this.config.set(sanearConfig(JSON.parse(crudoConfig)));
      } catch {
        await this.respaldar(CLAVE_CONFIG, crudoConfig);
      }
    }
  }

  /** Copia el dato original antes de que cualquier escritura lo reemplace. */
  private async respaldar(clave: string, valor: string): Promise<void> {
    try {
      await Preferences.set({ key: `${clave}_respaldo_${Date.now()}`, value: valor });
    } catch {
      this.escrituraBloqueada = true; // si no se pudo respaldar, mejor no escribir
    }
  }

  private persistirGastos(): Promise<void> {
    return Preferences.set({ key: CLAVE_GASTOS, value: JSON.stringify(this.gastos()) });
  }
}

// ===================== Saneo de datos =====================

function texto(o: Record<string, unknown>, clave: string): string | undefined {
  const v = o[clave];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** "2026-11-30" | "2026-11-30T22:00:00" | "2026-11-30T22:00:00-05:00" → "2026-11-30T22:00:00" (hora local). */
function normalizarFecha(valor: unknown): string | null {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(valor)) return null;
  return valor.length === 10 ? `${valor}T00:00:00` : valor.substring(0, 19);
}

export function sanearGasto(x: unknown): GastoItem | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const id = texto(o, 'id');
  const monto = aPesosEnteros(o['monto']);
  const fecha = normalizarFecha(o['fecha']);
  if (!id || !monto || !fecha) return null;

  const categoria = CATEGORIAS.some((c) => c.valor === o['categoria']) ? (o['categoria'] as CategoriaGasto) : 'otros';
  const esDeducibleRenta = o['esDeducibleRenta'] === true;
  const tipo = TIPOS_DEDUCIBLES.some((t) => t.valor === o['tipoDeducible'])
    ? (o['tipoDeducible'] as TipoDeducible)
    : undefined;
  const foto = texto(o, 'fotoNombreArchivo');
  const fotoValida = foto && /^[\w.-]+$/.test(foto) ? foto : undefined;

  return {
    id,
    titulo: texto(o, 'titulo'),
    comercio: texto(o, 'comercio') ?? 'Sin comercio',
    descripcion: texto(o, 'descripcion'),
    monto,
    fecha,
    // Los derivados se recalculan: no se confía en lo guardado
    anioFiscal: Number(fecha.substring(0, 4)),
    mesFiscal: fecha.substring(0, 7),
    categoria,
    esDeducibleRenta,
    tipoDeducible: esDeducibleRenta ? (tipo ?? 'otro_soporte') : undefined,
    tieneSoporte: !!fotoValida,
    fotoNombreArchivo: fotoValida,
    creadoEn: normalizarFecha(o['creadoEn']) ?? fecha,
  };
}

export function sanearConfig(x: unknown): ConfiguracionUsuario {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const anioActual = new Date().getFullYear();
  const anio = Number(o['anioFiscalActivo']);
  const moneda = texto(o, 'moneda');
  const correo = texto(o, 'correoContador');

  const topes: Partial<Record<TipoDeducible, number>> = {};
  const topesCrudos = o['topesDeducibles'];
  if (topesCrudos && typeof topesCrudos === 'object') {
    for (const t of TIPOS_DEDUCIBLES) {
      const v = aPesosEnteros((topesCrudos as Record<string, unknown>)[t.valor]);
      if (v) topes[t.valor] = v;
    }
  }

  return {
    presupuestoMensual: aPesosEnteros(o['presupuestoMensual']) ?? 0,
    moneda: moneda && /^[A-Z]{3}$/.test(moneda) ? moneda : CONFIG_POR_DEFECTO.moneda,
    anioFiscalActivo: Number.isInteger(anio) && anio >= 2000 && anio <= anioActual + 1 ? anio : anioActual,
    correoContador: correo && esCorreoValido(correo) ? correo : undefined,
    topesDeducibles: topes,
    alertaPresupuestoMostradaEn: texto(o, 'alertaPresupuestoMostradaEn'),
  };
}

export function esCorreoValido(correo: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(correo.trim());
}

function ordenar(lista: GastoItem[]): GastoItem[] {
  return [...lista].sort((a, b) => b.fecha.localeCompare(a.fecha) || b.creadoEn.localeCompare(a.creadoEn));
}

export function generarId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

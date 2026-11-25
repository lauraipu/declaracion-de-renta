export type CategoriaGasto =
  | 'alimentacion'
  | 'transporte'
  | 'salud'
  | 'educacion'
  | 'servicios'
  | 'hogar'
  | 'otros';

export type TipoDeducible =
  | 'factura_electronica' // Deducción general por compras con FE
  | 'salud_prepagada' // Medicina prepagada / seguros de salud
  | 'educacion' // Matrículas / educación
  | 'vivienda' // Intereses de crédito hipotecario / leasing
  | 'dependientes' // Gastos asociados a dependientes
  | 'otro_soporte';

export interface GastoItem {
  id: string; // UUID único
  titulo?: string; // Ej: "Consulta odontológica" o "Mercado"
  comercio: string; // Nombre del establecimiento
  descripcion?: string; // Nota opcional (ej. "Examen de laboratorio")
  monto: number; // Valor numérico sin separadores
  fecha: string; // ISO 8601 local: "2026-11-25T06:52:00"
  anioFiscal: number; // Extraído de la fecha (ej. 2026) para el Tab 3
  mesFiscal: string; // "2026-11" para filtrar rápido en el Tab 2
  categoria: CategoriaGasto;
  esDeducibleRenta: boolean;
  tipoDeducible?: TipoDeducible; // Requerido si esDeducibleRenta === true
  tieneSoporte: boolean; // Flag rápido para auditar soportes faltantes
  fotoNombreArchivo?: string; // Ej: "recibo_20261125_173253.jpg" en Directory.Data
  creadoEn: string; // Timestamp de creación
}

export interface ConfiguracionUsuario {
  presupuestoMensual: number;
  moneda: string; // Ej: "COP", "USD", "MXN"
  anioFiscalActivo: number;
  correoContador?: string; // Opcional para prellenar el envío
  /** Topes referenciales que el usuario quiera ver en el Tab 3 (opcional). */
  topesDeducibles?: Partial<Record<TipoDeducible, number>>;
  /** Mes ("2026-11") en el que ya se mostró la alerta de presupuesto excedido. */
  alertaPresupuestoMostradaEn?: string;
}

export interface OpcionCategoria {
  valor: CategoriaGasto;
  etiqueta: string;
  icono: string;
}

export interface OpcionDeducible {
  valor: TipoDeducible;
  etiqueta: string;
  ayuda: string;
}

export const CATEGORIAS: OpcionCategoria[] = [
  { valor: 'alimentacion', etiqueta: 'Alimentación', icono: 'restaurant-outline' },
  { valor: 'transporte', etiqueta: 'Transporte', icono: 'bus-outline' },
  { valor: 'salud', etiqueta: 'Salud', icono: 'medkit-outline' },
  { valor: 'educacion', etiqueta: 'Educación', icono: 'school-outline' },
  { valor: 'servicios', etiqueta: 'Servicios', icono: 'flash-outline' },
  { valor: 'hogar', etiqueta: 'Hogar', icono: 'home-outline' },
  { valor: 'otros', etiqueta: 'Otros', icono: 'pricetag-outline' },
];

export const TIPOS_DEDUCIBLES: OpcionDeducible[] = [
  {
    valor: 'factura_electronica',
    etiqueta: 'Factura Electrónica (1%)',
    ayuda: 'Compras pagadas con medios electrónicos y factura electrónica a tu nombre.',
  },
  {
    valor: 'salud_prepagada',
    etiqueta: 'Medicina Prepagada / Seguro de salud',
    ayuda: 'Pagos a medicina prepagada o pólizas de salud; se soporta con certificado anual.',
  },
  {
    valor: 'educacion',
    etiqueta: 'Educación',
    ayuda: 'Matrículas y gastos educativos (p. ej. intereses ICETEX); confirma si aplican.',
  },
  {
    valor: 'vivienda',
    etiqueta: 'Intereses de Vivienda',
    ayuda: 'Intereses de crédito hipotecario o leasing habitacional; certificado del banco.',
  },
  {
    valor: 'dependientes',
    etiqueta: 'Dependientes',
    ayuda: 'Gastos asociados a hijos, cónyuge o padres que dependan económicamente de ti.',
  },
  {
    valor: 'otro_soporte',
    etiqueta: 'Otro soporte',
    ayuda: 'Cualquier otro documento que tu contador te haya pedido guardar.',
  },
];

export const CONFIG_POR_DEFECTO: ConfiguracionUsuario = {
  presupuestoMensual: 0,
  moneda: 'COP',
  anioFiscalActivo: new Date().getFullYear(),
};

export function etiquetaCategoria(c: CategoriaGasto): string {
  return CATEGORIAS.find((x) => x.valor === c)?.etiqueta ?? c;
}

export function iconoCategoria(c: CategoriaGasto): string {
  return CATEGORIAS.find((x) => x.valor === c)?.icono ?? 'pricetag-outline';
}

export function etiquetaDeducible(t?: TipoDeducible): string {
  if (!t) return '';
  return TIPOS_DEDUCIBLES.find((x) => x.valor === t)?.etiqueta ?? t;
}

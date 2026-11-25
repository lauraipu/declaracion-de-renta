import { Injectable } from '@angular/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';

import { marcaArchivo } from '../models/fechas';

const CARPETA = 'recibos';
export const TAMANO_MAXIMO_MB = 10;
const TAMANO_MAXIMO = TAMANO_MAXIMO_MB * 1024 * 1024;
const LADO_MAXIMO = 2000; // px
const CALIDAD_JPEG = 0.8;
const LIMITE_CACHE_URLS = 40;
const UNA_HORA = 3_600_000;
/** Solo nombres generados por la app (evita rutas tipo "../../algo"). */
const NOMBRE_VALIDO = /^[\w.-]+$/;

export type ExtensionRecibo = 'jpg' | 'png' | 'webp' | 'pdf';

export interface ArchivoCapturado {
  base64: string;
  extension: ExtensionRecibo;
}

/** Archivo rechazado por formato o tamaño (el mensaje se puede mostrar al usuario). */
export class ArchivoInvalidoError extends Error {}
/** El usuario negó (o tiene bloqueado) el permiso de cámara. */
export class PermisoDenegadoError extends Error {}
/** No se pudo escribir en el almacenamiento del celular. */
export class AlmacenamientoLlenoError extends Error {}

/** Guarda, lee y borra las fotos/PDF de los recibos en Directory.Data. */
@Injectable({ providedIn: 'root' })
export class ArchivosService {
  /** Caché LRU de URLs para <img>. En web son Blob URLs que se liberan al salir. */
  private readonly urls = new Map<string, string>();

  readonly esNativo = Capacitor.isNativePlatform();

  // ===================== Permisos =====================

  async asegurarPermisoCamara(): Promise<boolean> {
    if (!this.esNativo) return true;
    try {
      let estado = await Camera.checkPermissions();
      if (estado.camera === 'prompt' || estado.camera === 'prompt-with-rationale') {
        estado = await Camera.requestPermissions({ permissions: ['camera'] });
      }
      return estado.camera === 'granted' || estado.camera === 'limited';
    } catch {
      return true; // si no se puede consultar, que lo decida getPhoto()
    }
  }

  // ===================== Captura =====================

  /** Abre la cámara o la galería. Devuelve null si el usuario cancela. */
  async capturar(origen: CameraSource = CameraSource.Camera): Promise<ArchivoCapturado | null> {
    if (origen === CameraSource.Camera && !(await this.asegurarPermisoCamara())) {
      throw new PermisoDenegadoError('Permiso de cámara denegado');
    }
    try {
      const foto = await Camera.getPhoto({
        quality: Math.round(CALIDAD_JPEG * 100),
        resultType: CameraResultType.Base64,
        source: origen,
        correctOrientation: true,
        webUseInput: true,
        width: LADO_MAXIMO, // la cámara ya entrega la imagen comprimida
      });
      if (!foto.base64String) return null;
      return { base64: foto.base64String, extension: foto.format === 'png' ? 'png' : 'jpg' };
    } catch (e) {
      if (esCancelacion(e)) return null;
      if (esPermiso(e)) throw new PermisoDenegadoError('Permiso denegado');
      throw e;
    }
  }

  /**
   * Valida un archivo elegido con <input type="file"> por su contenido real
   * (no por la extensión ni por el atributo accept) y comprime las imágenes.
   */
  async leerArchivoSeleccionado(archivo: File): Promise<ArchivoCapturado> {
    if (archivo.size === 0) throw new ArchivoInvalidoError('El archivo está vacío o dañado.');
    if (archivo.size > TAMANO_MAXIMO) {
      throw new ArchivoInvalidoError(`El archivo pesa más de ${TAMANO_MAXIMO_MB} MB. Elige uno más liviano.`);
    }
    const tipo = await tipoReal(archivo);
    if (!tipo) {
      throw new ArchivoInvalidoError('Formato no soportado. Usa una foto JPG, PNG o WEBP, o un PDF.');
    }
    if (tipo === 'pdf') {
      return { base64: await aBase64(archivo), extension: 'pdf' };
    }
    try {
      return { base64: await comprimir(archivo), extension: 'jpg' };
    } catch {
      throw new ArchivoInvalidoError('La imagen está dañada o no se puede abrir.');
    }
  }

  // ===================== Disco =====================

  /** Guarda el archivo y devuelve el nombre generado (recibo_20261125_173253_ab12.jpg). */
  async guardar(archivo: ArchivoCapturado): Promise<string> {
    const nombre = `recibo_${marcaArchivo()}_${Math.random().toString(36).slice(2, 6)}.${archivo.extension}`;
    try {
      await Filesystem.writeFile({
        path: `${CARPETA}/${nombre}`,
        data: archivo.base64,
        directory: Directory.Data,
        recursive: true,
      });
    } catch {
      throw new AlmacenamientoLlenoError('No se pudo guardar el archivo');
    }
    return nombre;
  }

  /** URL lista para <img src>. */
  async obtenerUrl(nombre: string): Promise<string> {
    validarNombre(nombre);
    const enCache = this.urls.get(nombre);
    if (enCache) {
      this.recordar(nombre, enCache); // lo marca como usado recientemente
      return enCache;
    }

    let url: string;
    if (this.esNativo) {
      // En el celular es una ruta, no los datos: no ocupa memoria.
      url = Capacitor.convertFileSrc(await this.obtenerUriNativa(nombre));
    } else {
      // En web se usa un Blob URL (no un data URL de varios MB en un string).
      const { data } = await Filesystem.readFile({ path: `${CARPETA}/${nombre}`, directory: Directory.Data });
      const blob = data instanceof Blob ? data : base64ABlob(data, mimeDe(nombre));
      url = URL.createObjectURL(blob);
    }
    this.recordar(nombre, url);
    return url;
  }

  /** file:///... del archivo (para OCR y para compartir en el celular). */
  async obtenerUriNativa(nombre: string): Promise<string> {
    validarNombre(nombre);
    const { uri } = await Filesystem.getUri({ path: `${CARPETA}/${nombre}`, directory: Directory.Data });
    return uri;
  }

  async eliminar(nombre?: string): Promise<void> {
    if (!nombre || !NOMBRE_VALIDO.test(nombre)) return;
    this.olvidar(nombre);
    try {
      await Filesystem.deleteFile({ path: `${CARPETA}/${nombre}`, directory: Directory.Data });
    } catch {
      // Si ya no existe, no hay nada que hacer.
    }
  }

  /**
   * Borra archivos que ningún gasto usa (fotos tomadas y nunca guardadas,
   * o borradas mientras se mostraba "Deshacer" y la app se cerró).
   * No toca lo creado en la última hora para no borrar una captura en curso.
   */
  async limpiarHuerfanos(enUso: ReadonlySet<string>): Promise<number> {
    let borrados = 0;
    try {
      const { files } = await Filesystem.readdir({ path: CARPETA, directory: Directory.Data });
      const limite = Date.now() - UNA_HORA;
      for (const f of files) {
        if (f.type === 'file' && !enUso.has(f.name) && (f.mtime ?? 0) < limite) {
          await this.eliminar(f.name);
          borrados++;
        }
      }
    } catch {
      // La carpeta aún no existe: nada que limpiar.
    }
    return borrados;
  }

  esPdf(nombre?: string): boolean {
    return !!nombre && nombre.toLowerCase().endsWith('.pdf');
  }

  // ===================== Caché de URLs =====================

  private recordar(nombre: string, url: string): void {
    this.urls.delete(nombre);
    this.urls.set(nombre, url);
    while (this.urls.size > LIMITE_CACHE_URLS) {
      const masViejo = this.urls.keys().next().value;
      if (masViejo === undefined) break;
      this.olvidar(masViejo);
    }
  }

  private olvidar(nombre: string): void {
    const url = this.urls.get(nombre);
    if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
    this.urls.delete(nombre);
  }
}

// ===================== Utilidades =====================

export function esCancelacion(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return msg.includes('cancel');
}

function esPermiso(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return msg.includes('denied') || msg.includes('permission');
}

function validarNombre(nombre: string): void {
  if (!NOMBRE_VALIDO.test(nombre)) throw new Error('Nombre de archivo inválido');
}

/** Detecta el formato por los primeros bytes (firma o "magic number"). */
async function tipoReal(archivo: File): Promise<ExtensionRecibo | null> {
  const b = new Uint8Array(await archivo.slice(0, 12).arrayBuffer());
  const hex = (i: number, n: number) =>
    Array.from(b.slice(i, i + n), (x) => x.toString(16).padStart(2, '0')).join('');
  if (hex(0, 3) === 'ffd8ff') return 'jpg';
  if (hex(0, 8) === '89504e470d0a1a0a') return 'png';
  if (hex(0, 4) === '25504446') return 'pdf'; // %PDF
  if (hex(0, 4) === '52494646' && hex(8, 4) === '57454250') return 'webp'; // RIFF....WEBP
  return null; // HEIC, docx, exe, archivo corrupto…
}

/** Reduce la imagen a LADO_MAXIMO px y la pasa a JPEG; libera memoria al terminar. */
async function comprimir(archivo: File): Promise<string> {
  const bitmap = await createImageBitmap(archivo);
  const canvas = document.createElement('canvas');
  try {
    const escala = Math.min(1, LADO_MAXIMO / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * escala));
    canvas.height = Math.max(1, Math.round(bitmap.height * escala));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Sin contexto 2D');
    ctx.fillStyle = '#ffffff'; // fondo blanco para PNG con transparencia
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', CALIDAD_JPEG);
    return dataUrl.substring(dataUrl.indexOf(',') + 1);
  } finally {
    bitmap.close();
    canvas.width = 0; // libera el búfer del canvas
    canvas.height = 0;
  }
}

function aBase64(archivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onerror = () => reject(lector.error);
    lector.onload = () => {
      const dataUrl = String(lector.result);
      resolve(dataUrl.substring(dataUrl.indexOf(',') + 1));
    };
    lector.readAsDataURL(archivo);
  });
}

function base64ABlob(base64: string, tipo: string): Blob {
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return new Blob([bytes], { type: tipo });
}

function mimeDe(nombre: string): string {
  const ext = nombre.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg';
}

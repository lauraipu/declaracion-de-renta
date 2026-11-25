import { Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { CameraSource } from '@capacitor/camera';
import {
  ActionSheetController,
  AlertController,
  IonButton,
  IonButtons,
  IonCard,
  IonContent,
  IonDatetime,
  IonDatetimeButton,
  IonFab,
  IonFabButton,
  IonFooter,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonModal,
  IonNote,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonTextarea,
  IonTitle,
  IonToggle,
  IonToolbar,
  ModalController,
  ToastController,
} from '@ionic/angular';
import { Subscription } from 'rxjs';

import { CampoDineroComponent } from '../components/campo-dinero/campo-dinero.component';
import { VisorReciboModalComponent } from '../components/visor-recibo-modal/visor-recibo-modal.component';
import { isoLocal } from '../models/fechas';
import { CATEGORIAS, CategoriaGasto, GastoItem, TIPOS_DEDUCIBLES, TipoDeducible } from '../models/gasto.model';
import { hoy } from '../models/reloj';
import { formatearMoneda } from '../pipes/moneda.pipe';
import { AlmacenamientoService, generarId } from '../services/almacenamiento.service';
import {
  AlmacenamientoLlenoError,
  ArchivoCapturado,
  ArchivoInvalidoError,
  ArchivosService,
  PermisoDenegadoError,
  TAMANO_MAXIMO_MB,
} from '../services/archivos.service';
import { OcrService } from '../services/ocr.service';
import { sumarPesos } from '../utils/dinero';

@Component({
  selector: 'app-tab1',
  templateUrl: 'tab1.page.html',
  styleUrls: ['tab1.page.scss'],
  imports: [
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonContent,
    IonCard,
    IonIcon,
    IonFab,
    IonFabButton,
    IonSpinner,
    IonList,
    IonItem,
    IonInput,
    IonLabel,
    IonDatetimeButton,
    IonModal,
    IonDatetime,
    IonSelect,
    IonSelectOption,
    IonTextarea,
    IonToggle,
    IonNote,
    IonFooter,
    CampoDineroComponent,
  ],
})
export class Tab1Page implements OnInit, OnDestroy {
  private readonly datos = inject(AlmacenamientoService);
  private readonly archivos = inject(ArchivosService);
  readonly ocr = inject(OcrService);
  private readonly alertas = inject(AlertController);
  private readonly toasts = inject(ToastController);
  private readonly modales = inject(ModalController);
  private readonly hojas = inject(ActionSheetController);
  private readonly ruta = inject(ActivatedRoute);
  private readonly router = inject(Router);

  @ViewChild('selectorArchivo') selectorArchivo!: ElementRef<HTMLInputElement>;
  @ViewChild(IonContent) contenido?: IonContent;

  readonly categorias = CATEGORIAS;
  readonly tipos = TIPOS_DEDUCIBLES;
  readonly tamanoMaximoMb = TAMANO_MAXIMO_MB;
  /** Fecha máxima seleccionable: se actualiza sola al pasar la medianoche. */
  readonly maxFecha = computed(() => `${hoy()}T23:59:59`);

  // ----- Formulario (el monto SIEMPRE es un entero en pesos o null) -----
  monto: number | null = null;
  comercio = '';
  fecha = isoLocal();
  categoria: CategoriaGasto = 'alimentacion';
  descripcion = '';
  esDeducible = false;
  tipoDeducible: TipoDeducible | null = null;
  intentoGuardar = false;
  private fechaTocada = false;

  // ----- Foto / estado -----
  readonly foto = signal<string | undefined>(undefined);
  readonly fotoUrl = signal<string | null>(null);
  readonly leyendo = signal(false);
  readonly procesando = signal(false);
  readonly guardando = signal(false);
  readonly edicion = signal<GastoItem | null>(null);

  /** Archivos creados en esta captura que aún no pertenecen a ningún gasto guardado. */
  private readonly temporales = new Set<string>();
  /** Id reservado para el gasto en curso: un reintento tras error no duplica. */
  private idBorrador?: string;
  /** Turno del OCR vigente: los resultados de fotos reemplazadas se descartan. */
  private turnoOcr = 0;
  private sub?: Subscription;

  ngOnInit(): void {
    this.sub = this.ruta.queryParamMap.subscribe(async (p) => {
      const id = p.get('editar');
      if (!id) return;
      await this.datos.listo();
      const g = this.datos.obtener(id);
      if (g) await this.cargarParaEditar(g);
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  // ===================== Validaciones =====================
  get montoValido(): boolean {
    return this.monto !== null && this.monto > 0;
  }
  get comercioValido(): boolean {
    return this.comercio.trim().length > 0;
  }
  get tipoValido(): boolean {
    return !this.esDeducible || !!this.tipoDeducible;
  }
  /** ¿Hay algo escrito que se perdería al descartar? */
  get hayDatos(): boolean {
    return (
      !!this.edicion() ||
      this.monto !== null ||
      !!this.comercio.trim() ||
      !!this.descripcion.trim() ||
      !!this.foto() ||
      this.esDeducible
    );
  }

  alCambiarFecha(): void {
    this.fechaTocada = true;
  }

  // ===================== Captura =====================
  async tomarFoto(origen: CameraSource = CameraSource.Camera): Promise<void> {
    if (this.procesando()) return;
    let capturado: ArchivoCapturado | null;
    try {
      capturado = await this.archivos.capturar(origen);
    } catch (e) {
      if (e instanceof PermisoDenegadoError) {
        await this.alertaPermisoCamara();
      } else {
        await this.aviso('No se pudo abrir la cámara. Inténtalo de nuevo.');
      }
      return;
    }
    if (capturado) await this.usarArchivo(capturado);
  }

  subirArchivo(): void {
    if (this.procesando()) return;
    this.selectorArchivo.nativeElement.click();
  }

  async alSeleccionarArchivo(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const archivo = input.files?.[0];
    input.value = '';
    if (!archivo) return;
    this.procesando.set(true);
    let capturado: ArchivoCapturado;
    try {
      capturado = await this.archivos.leerArchivoSeleccionado(archivo);
    } catch (e) {
      await this.aviso(e instanceof ArchivoInvalidoError ? e.message : 'No se pudo leer el archivo seleccionado.', 3000);
      return;
    } finally {
      this.procesando.set(false);
    }
    await this.usarArchivo(capturado);
  }

  async reemplazar(): Promise<void> {
    const hoja = await this.hojas.create({
      header: 'Recibo',
      buttons: [
        { text: 'Tomar otra foto', icon: 'camera-outline', handler: () => void this.tomarFoto() },
        { text: 'Subir otro archivo', icon: 'cloud-upload-outline', handler: () => this.subirArchivo() },
        { text: 'Quitar recibo', icon: 'trash-outline', role: 'destructive', handler: () => void this.quitarFoto() },
        { text: 'Cancelar', role: 'cancel' },
      ],
    });
    await hoja.present();
  }

  async verGrande(): Promise<void> {
    const borrador = this.datos.construirGasto({
      comercio: this.comercio || 'Recibo',
      monto: this.monto ?? 0,
      fecha: this.fecha,
      categoria: this.categoria,
      esDeducibleRenta: false,
      fotoNombreArchivo: this.foto(),
    });
    const modal = await this.modales.create({
      component: VisorReciboModalComponent,
      componentProps: { gasto: borrador, soloLectura: true },
      cssClass: 'modal-visor',
    });
    await modal.present();
  }

  private async usarArchivo(capturado: ArchivoCapturado): Promise<void> {
    this.procesando.set(true);
    let nombre: string;
    try {
      nombre = await this.archivos.guardar(capturado);
    } catch (e) {
      await this.aviso(
        e instanceof AlmacenamientoLlenoError
          ? 'No hay espacio suficiente en el celular para guardar el recibo.'
          : 'No se pudo guardar el recibo. Inténtalo de nuevo.',
        3000,
      );
      return;
    } finally {
      this.procesando.set(false);
    }

    await this.descartarTemporal(this.foto());
    this.temporales.add(nombre);
    this.foto.set(nombre);
    this.fotoUrl.set(
      this.archivos.esPdf(nombre) ? null : await this.archivos.obtenerUrl(nombre).catch(() => null),
    );
    if (this.ocr.disponible && !this.archivos.esPdf(nombre)) {
      await this.leerConOcr(nombre);
    }
  }

  private async quitarFoto(): Promise<void> {
    this.turnoOcr++; // invalida un OCR en curso
    this.leyendo.set(false);
    await this.descartarTemporal(this.foto());
    this.foto.set(undefined);
    this.fotoUrl.set(null);
  }

  /** Borra el archivo solo si es temporal (nunca el de un gasto ya guardado). */
  private async descartarTemporal(nombre?: string): Promise<void> {
    if (nombre && this.temporales.has(nombre)) {
      this.temporales.delete(nombre);
      await this.archivos.eliminar(nombre);
    }
  }

  private async leerConOcr(nombre: string): Promise<void> {
    const turno = ++this.turnoOcr;
    this.leyendo.set(true);
    try {
      const leido = await this.ocr.leerRecibo(nombre);
      // Si mientras tanto se reemplazó o quitó la foto, este resultado ya no aplica
      if (turno !== this.turnoOcr || this.foto() !== nombre || !leido) return;

      const completados: string[] = [];
      if (leido.monto && this.monto === null) {
        this.monto = leido.monto;
        completados.push(`monto ${formatearMoneda(leido.monto)}`);
      }
      // Nunca se pisa una fecha elegida por el usuario ni la de un gasto que se está editando
      if (leido.fecha && !this.fechaTocada && !this.edicion()) {
        this.fecha = `${leido.fecha}T12:00:00`;
        completados.push('fecha');
      }
      if (leido.comercio && !this.comercio.trim()) {
        this.comercio = leido.comercio;
        completados.push('comercio');
      }
      await this.aviso(
        completados.length
          ? `Leímos ${completados.join(', ')}. Revisa que estén correctos.`
          : 'No encontramos datos claros en el recibo. Escríbelos a mano.',
        3000,
      );
    } catch {
      if (turno === this.turnoOcr) await this.aviso('No pudimos leer el recibo. Escribe los datos a mano.');
    } finally {
      if (turno === this.turnoOcr) this.leyendo.set(false);
    }
  }

  // ===================== Guardar / descartar =====================
  async guardar(): Promise<void> {
    // Cierre real contra doble toque: no depende de que el botón ya se vea deshabilitado
    if (this.guardando()) return;
    this.guardando.set(true);
    try {
      this.intentoGuardar = true;
      if (!this.montoValido || !this.comercioValido || !this.tipoValido) {
        await this.aviso('Revisa los campos marcados en rojo.');
        return;
      }
      if (this.esDeducible && !this.foto() && !(await this.confirmarSinSoporte())) {
        await this.contenido?.scrollToTop(300);
        return;
      }

      const original = this.edicion();
      this.idBorrador ??= original?.id ?? generarId();
      const gasto = this.datos.construirGasto({
        id: this.idBorrador,
        creadoEn: original?.creadoEn,
        titulo: original?.titulo, // campo heredado de versiones anteriores
        comercio: this.comercio.trim(),
        descripcion: this.descripcion.trim() || undefined,
        monto: this.monto!,
        fecha: this.fecha,
        categoria: this.categoria,
        esDeducibleRenta: this.esDeducible,
        tipoDeducible: this.esDeducible ? (this.tipoDeducible ?? undefined) : undefined,
        fotoNombreArchivo: this.foto(),
      });

      const mes = gasto.mesFiscal;
      const antes = sumarPesos(
        this.datos.gastos().filter((g) => g.mesFiscal === mes && g.id !== gasto.id).map((g) => g.monto),
      );
      const despues = antes + gasto.monto;

      await this.datos.guardarGasto(gasto);
      this.idBorrador = undefined;
      if (gasto.fotoNombreArchivo) this.temporales.delete(gasto.fotoNombreArchivo);
      if (original?.fotoNombreArchivo && original.fotoNombreArchivo !== gasto.fotoNombreArchivo) {
        await this.archivos.eliminar(original.fotoNombreArchivo);
      }

      this.reiniciarFormulario();
      await this.aviso(original ? '✓ Gasto actualizado' : '✓ Gasto guardado');
      await this.revisarPresupuesto(mes, antes, despues);

      if (original) {
        // Quita ?editar=... de la pestaña para que no se vuelva a cargar al regresar
        await this.router.navigate(['/tabs/tab1'], { replaceUrl: true });
        await this.router.navigate(['/tabs/tab2']);
      }
    } catch {
      await this.aviso('No se pudo guardar el gasto. Inténtalo de nuevo.', 3000);
    } finally {
      this.guardando.set(false);
    }
  }

  /** Botón X de la cabecera: pide confirmación si hay algo que se perdería. */
  async descartar(): Promise<void> {
    if (this.guardando()) return;
    if (this.hayDatos) {
      const alerta = await this.alertas.create({
        header: this.edicion() ? '¿Descartar los cambios?' : '¿Descartar este gasto?',
        message: this.edicion()
          ? 'El gasto guardado no se modificará.'
          : 'Se borrarán los datos escritos y el recibo adjunto.',
        buttons: [
          { text: 'Seguir editando', role: 'cancel' },
          { text: 'Descartar', role: 'destructive' },
        ],
      });
      await alerta.present();
      const { role } = await alerta.onDidDismiss();
      if (role !== 'destructive') return;
    }
    await this.limpiar();
  }

  private async limpiar(): Promise<void> {
    this.turnoOcr++;
    await this.descartarTemporal(this.foto());
    const estabaEditando = !!this.edicion();
    this.reiniciarFormulario();
    if (estabaEditando) {
      await this.router.navigate([], { relativeTo: this.ruta, queryParams: {}, replaceUrl: true });
    }
  }

  private reiniciarFormulario(): void {
    this.monto = null;
    this.comercio = '';
    this.fecha = isoLocal();
    this.categoria = 'alimentacion';
    this.descripcion = '';
    this.esDeducible = false;
    this.tipoDeducible = null;
    this.intentoGuardar = false;
    this.fechaTocada = false;
    this.idBorrador = undefined;
    this.leyendo.set(false);
    this.foto.set(undefined);
    this.fotoUrl.set(null);
    this.edicion.set(null);
    this.temporales.clear();
  }

  private async cargarParaEditar(g: GastoItem): Promise<void> {
    this.turnoOcr++;
    await this.descartarTemporal(this.foto());
    this.reiniciarFormulario();
    this.edicion.set(g);
    this.monto = g.monto;
    this.comercio = g.comercio;
    this.fecha = g.fecha;
    this.categoria = g.categoria;
    this.descripcion = g.descripcion ?? '';
    this.esDeducible = g.esDeducibleRenta;
    this.tipoDeducible = g.tipoDeducible ?? null;
    this.foto.set(g.fotoNombreArchivo);
    this.fotoUrl.set(
      g.fotoNombreArchivo && !this.archivos.esPdf(g.fotoNombreArchivo)
        ? await this.archivos.obtenerUrl(g.fotoNombreArchivo).catch(() => null)
        : null,
    );
  }

  // ===================== Diálogos =====================
  private async confirmarSinSoporte(): Promise<boolean> {
    const alerta = await this.alertas.create({
      header: 'Deducible sin soporte',
      message:
        'Marcaste este gasto como deducible pero no tiene foto ni archivo del recibo. Sin soporte, tu contador podría no aceptarlo.',
      buttons: [
        { text: 'Adjuntar recibo', role: 'cancel' },
        { text: 'Guardar sin soporte', role: 'confirm' },
      ],
    });
    await alerta.present();
    const { role } = await alerta.onDidDismiss();
    return role === 'confirm';
  }

  private async alertaPermisoCamara(): Promise<void> {
    const alerta = await this.alertas.create({
      header: 'Permiso de cámara desactivado',
      message:
        'Para fotografiar recibos, activa la cámara en Ajustes › Aplicaciones › Gastos y Renta › Permisos. Mientras tanto puedes adjuntar una foto con "Subir archivo".',
      buttons: [
        { text: 'Subir archivo', handler: () => this.subirArchivo() },
        { text: 'Entendido', role: 'cancel' },
      ],
    });
    await alerta.present();
  }

  /** Alerta única cuando este gasto hace cruzar el 100 % del presupuesto del mes. */
  private async revisarPresupuesto(mes: string, antes: number, despues: number): Promise<void> {
    const config = this.datos.config();
    const tope = config.presupuestoMensual;
    if (tope <= 0 || antes >= tope || despues < tope || config.alertaPresupuestoMostradaEn === mes) return;
    await this.datos.guardarConfig({ alertaPresupuestoMostradaEn: mes });
    const alerta = await this.alertas.create({
      header: 'Presupuesto excedido',
      message: `Con este gasto llevas ${formatearMoneda(despues)} de un tope de ${formatearMoneda(tope)} este mes.`,
      buttons: ['Entendido'],
    });
    await alerta.present();
    await alerta.onDidDismiss();
  }

  private async aviso(mensaje: string, duracion = 2000): Promise<void> {
    const t = await this.toasts.create({ message: mensaje, duration: duracion, position: 'top' });
    await t.present();
  }
}

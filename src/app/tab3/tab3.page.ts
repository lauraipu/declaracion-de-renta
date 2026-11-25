import { Component, ElementRef, ViewChild, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CameraSource } from '@capacitor/camera';
import {
  ActionSheetController,
  AlertController,
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardSubtitle,
  IonCardTitle,
  IonContent,
  IonFooter,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonProgressBar,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonTitle,
  IonToolbar,
  ModalController,
  ToastController,
} from '@ionic/angular';

import { GuiaRentaModalComponent } from '../components/guia-renta-modal/guia-renta-modal.component';
import { MiniaturaReciboComponent } from '../components/miniatura-recibo/miniatura-recibo.component';
import { VisorReciboModalComponent } from '../components/visor-recibo-modal/visor-recibo-modal.component';
import { fechaCorta } from '../models/fechas';
import { GastoItem, TIPOS_DEDUCIBLES, etiquetaDeducible } from '../models/gasto.model';
import { MonedaPipe } from '../pipes/moneda.pipe';
import { AlmacenamientoService } from '../services/almacenamiento.service';
import {
  AlmacenamientoLlenoError,
  ArchivoCapturado,
  ArchivoInvalidoError,
  ArchivosService,
  PermisoDenegadoError,
} from '../services/archivos.service';
import { ExportacionService } from '../services/exportacion.service';
import { sumarPesos } from '../utils/dinero';

interface ResumenRubro {
  etiqueta: string;
  total: number;
  cantidad: number;
  tope?: number;
  progreso: number;
}

@Component({
  selector: 'app-tab3',
  templateUrl: 'tab3.page.html',
  styleUrls: ['tab3.page.scss'],
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonIcon,
    IonSelect,
    IonSelectOption,
    IonContent,
    IonCard,
    IonCardHeader,
    IonCardSubtitle,
    IonCardTitle,
    IonCardContent,
    IonList,
    IonListHeader,
    IonItem,
    IonLabel,
    IonNote,
    IonProgressBar,
    IonSpinner,
    IonFooter,
    MonedaPipe,
    MiniaturaReciboComponent,
  ],
})
export class Tab3Page {
  private readonly datos = inject(AlmacenamientoService);
  private readonly archivos = inject(ArchivosService);
  private readonly exportacion = inject(ExportacionService);
  private readonly modales = inject(ModalController);
  private readonly toasts = inject(ToastController);
  private readonly hojas = inject(ActionSheetController);
  private readonly alertas = inject(AlertController);
  private readonly router = inject(Router);

  @ViewChild('selectorArchivo') selectorArchivo!: ElementRef<HTMLInputElement>;

  readonly fechaCorta = fechaCorta;
  readonly etiquetaDeducible = etiquetaDeducible;
  readonly config = this.datos.config;

  private readonly anioElegido = signal<number | null>(null);
  readonly anio = computed(() => this.anioElegido() ?? this.config().anioFiscalActivo);
  readonly anios = computed(() => {
    const actual = new Date().getFullYear();
    const set = new Set<number>([actual, actual - 1, this.config().anioFiscalActivo]);
    this.datos.gastos().forEach((g) => set.add(g.anioFiscal));
    return [...set].sort((a, b) => b - a);
  });

  readonly deducibles = computed(() =>
    this.datos.gastos().filter((g) => g.esDeducibleRenta && g.anioFiscal === this.anio()),
  );
  readonly total = computed(() => sumarPesos(this.deducibles().map((g) => g.monto)));
  readonly sinSoporte = computed(() => this.deducibles().filter((g) => !g.tieneSoporte));
  readonly soloSinSoporte = signal(false);
  readonly historial = computed(() => (this.soloSinSoporte() ? this.sinSoporte() : this.deducibles()));

  readonly rubros = computed<ResumenRubro[]>(() => {
    const topes = this.config().topesDeducibles ?? {};
    return TIPOS_DEDUCIBLES.map((t) => {
      const delTipo = this.deducibles().filter((g) => g.tipoDeducible === t.valor);
      const total = sumarPesos(delTipo.map((g) => g.monto));
      const tope = topes[t.valor];
      return {
        etiqueta: t.etiqueta,
        total,
        cantidad: delTipo.length,
        tope,
        progreso: tope ? Math.min(1, total / tope) : 0,
      };
    }).filter((r) => r.cantidad > 0 || r.tope);
  });

  readonly exportando = signal(false);
  readonly tieneTope = (r: ResumenRubro) => !!r.tope;
  private pendienteAdjuntar: GastoItem | null = null;

  cambiarAnio(valor: unknown): void {
    this.anioElegido.set(Number(valor));
    this.soloSinSoporte.set(false);
  }

  alternarSinSoporte(): void {
    this.soloSinSoporte.update((v) => !v);
  }

  async abrirGuia(): Promise<void> {
    const modal = await this.modales.create({
      component: GuiaRentaModalComponent,
      initialBreakpoint: 0.65,
      breakpoints: [0, 0.65, 1],
    });
    await modal.present();
  }

  async verRecibo(g: GastoItem): Promise<void> {
    const modal = await this.modales.create({
      component: VisorReciboModalComponent,
      componentProps: { gasto: g },
      cssClass: 'modal-visor',
    });
    await modal.present();
  }

  async adjuntar(g: GastoItem): Promise<void> {
    this.pendienteAdjuntar = g;
    const hoja = await this.hojas.create({
      header: `Adjuntar soporte de ${g.comercio}`,
      buttons: [
        { text: 'Tomar foto', icon: 'camera-outline', handler: () => void this.capturar(CameraSource.Camera) },
        { text: 'Elegir de la galería', icon: 'image-outline', handler: () => void this.capturar(CameraSource.Photos) },
        { text: 'Subir PDF o archivo', icon: 'document-outline', handler: () => this.selectorArchivo.nativeElement.click() },
        { text: 'Cancelar', role: 'cancel' },
      ],
    });
    await hoja.present();
  }

  async alSeleccionarArchivo(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const archivo = input.files?.[0];
    input.value = '';
    if (!archivo) return;
    let capturado: ArchivoCapturado;
    try {
      capturado = await this.archivos.leerArchivoSeleccionado(archivo);
    } catch (e) {
      this.pendienteAdjuntar = null;
      await this.aviso(e instanceof ArchivoInvalidoError ? e.message : 'No se pudo leer el archivo.', 3000);
      return;
    }
    await this.guardarSoporte(capturado);
  }

  irARegistrar(): void {
    void this.router.navigate(['/tabs/tab1']);
  }

  async exportar(): Promise<void> {
    // Cierre contra doble toque y contra exportar un paquete vacío
    if (this.exportando() || !this.deducibles().length) return;
    this.exportando.set(true);
    try {
      const r = await this.exportacion.exportarAnual(this.deducibles(), this.anio(), this.config());
      if (r === 'compartido') await this.aviso('✓ Paquete para el contador generado');
      if (r === 'descargado') await this.aviso('✓ Archivo CSV descargado');
    } catch {
      await this.aviso('No se pudo generar el paquete. Inténtalo de nuevo.');
    } finally {
      this.exportando.set(false);
    }
  }

  private async capturar(origen: CameraSource): Promise<void> {
    let capturado: ArchivoCapturado | null;
    try {
      capturado = await this.archivos.capturar(origen);
    } catch (e) {
      this.pendienteAdjuntar = null;
      if (e instanceof PermisoDenegadoError) {
        const a = await this.alertas.create({
          header: 'Permiso de cámara desactivado',
          message:
            'Actívalo en Ajustes › Aplicaciones › Gastos y Renta › Permisos, o adjunta el soporte con "Subir PDF o archivo".',
          buttons: ['Entendido'],
        });
        await a.present();
      } else {
        await this.aviso('No se pudo abrir la cámara. Inténtalo de nuevo.');
      }
      return;
    }
    if (capturado) await this.guardarSoporte(capturado);
    else this.pendienteAdjuntar = null;
  }

  private async guardarSoporte(capturado: ArchivoCapturado): Promise<void> {
    const g = this.pendienteAdjuntar;
    if (!g) return;
    this.pendienteAdjuntar = null;
    let nombre: string | undefined;
    try {
      nombre = await this.archivos.guardar(capturado);
      await this.datos.guardarGasto({ ...g, fotoNombreArchivo: nombre, tieneSoporte: true });
    } catch (e) {
      await this.archivos.eliminar(nombre); // no deja el archivo huérfano
      await this.aviso(
        e instanceof AlmacenamientoLlenoError
          ? 'No hay espacio suficiente en el celular para guardar el soporte.'
          : 'No se pudo adjuntar el soporte. Inténtalo de nuevo.',
        3000,
      );
      return;
    }
    if (g.fotoNombreArchivo) await this.archivos.eliminar(g.fotoNombreArchivo);
    if (!this.sinSoporte().length) this.soloSinSoporte.set(false);
    await this.aviso('✓ Soporte adjuntado');
  }

  private async aviso(mensaje: string, duracion = 2000): Promise<void> {
    const t = await this.toasts.create({ message: mensaje, duration: duracion, position: 'top' });
    await t.present();
  }
}

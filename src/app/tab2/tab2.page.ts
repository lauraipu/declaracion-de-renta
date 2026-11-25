import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  AlertController,
  IonBadge,
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonItemOption,
  IonItemOptions,
  IonItemSliding,
  IonLabel,
  IonList,
  IonNote,
  IonProgressBar,
  IonSegment,
  IonSegmentButton,
  IonTitle,
  IonToolbar,
  ModalController,
  ToastController,
} from '@ionic/angular';

import { ConfigPresupuestoModalComponent } from '../components/config-presupuesto-modal/config-presupuesto-modal.component';
import { MiniaturaReciboComponent } from '../components/miniatura-recibo/miniatura-recibo.component';
import { VisorReciboModalComponent } from '../components/visor-recibo-modal/visor-recibo-modal.component';
import { fechaCorta, moverMes, nombreMes } from '../models/fechas';
import { CATEGORIAS, ConfiguracionUsuario, GastoItem, etiquetaCategoria } from '../models/gasto.model';
import { mesHoy } from '../models/reloj';
import { MonedaPipe } from '../pipes/moneda.pipe';
import { AlmacenamientoService } from '../services/almacenamiento.service';
import { sumarPesos } from '../utils/dinero';
import { ArchivosService } from '../services/archivos.service';

interface EstadoPresupuesto {
  color: string;
  icono: string;
  texto: string;
}

@Component({
  selector: 'app-tab2',
  templateUrl: 'tab2.page.html',
  styleUrls: ['tab2.page.scss'],
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonIcon,
    IonContent,
    IonCard,
    IonCardContent,
    IonProgressBar,
    IonSegment,
    IonSegmentButton,
    IonLabel,
    IonList,
    IonItemSliding,
    IonItem,
    IonItemOptions,
    IonItemOption,
    IonBadge,
    IonNote,
    MonedaPipe,
    MiniaturaReciboComponent,
  ],
})
export class Tab2Page {
  private readonly datos = inject(AlmacenamientoService);
  private readonly archivos = inject(ArchivosService);
  private readonly modales = inject(ModalController);
  private readonly alertas = inject(AlertController);
  private readonly toasts = inject(ToastController);
  private readonly router = inject(Router);

  readonly fechaCorta = fechaCorta;
  readonly etiquetaCategoria = etiquetaCategoria;
  readonly filtros = [
    { valor: 'todos', etiqueta: 'Todos' },
    { valor: 'deducibles', etiqueta: 'Deducibles' },
    ...CATEGORIAS.map((c) => ({ valor: c.valor as string, etiqueta: c.etiqueta })),
  ];

  readonly mes = signal(mesHoy());
  readonly filtro = signal('todos');

  readonly config = this.datos.config;
  readonly titulo = computed(() => nombreMes(this.mes()));
  /** No se navega a meses futuros (se recalcula solo al cambiar de mes). */
  readonly esMesActual = computed(() => this.mes() >= mesHoy());
  readonly errorCarga = this.datos.errorCarga;

  readonly gastosMes = computed(() => this.datos.gastos().filter((g) => g.mesFiscal === this.mes()));
  readonly visibles = computed(() => {
    const f = this.filtro();
    const lista = this.gastosMes();
    if (f === 'todos') return lista;
    if (f === 'deducibles') return lista.filter((g) => g.esDeducibleRenta);
    return lista.filter((g) => g.categoria === f);
  });

  readonly gastado = computed(() => sumarPesos(this.gastosMes().map((g) => g.monto)));
  readonly presupuesto = computed(() => this.config().presupuestoMensual);
  readonly disponible = computed(() => this.presupuesto() - this.gastado());
  readonly porcentaje = computed(() => (this.presupuesto() > 0 ? (this.gastado() / this.presupuesto()) * 100 : 0));
  readonly progreso = computed(() => Math.min(1, this.porcentaje() / 100));

  /** Color + ícono + texto: nunca dependemos solo del color (accesibilidad). */
  readonly estado = computed<EstadoPresupuesto>(() => {
    const p = Math.round(this.porcentaje());
    if (p >= 100) return { color: 'rosa', icono: 'alert-circle-outline', texto: `Presupuesto excedido (${p}% usado)` };
    if (p >= 75) return { color: 'lavanda', icono: 'warning-outline', texto: `Cerca del tope: ${p}% del presupuesto usado` };
    return { color: 'azul-lavanda', icono: 'checkmark-circle-outline', texto: `Vas bien: ${p}% del presupuesto usado` };
  });

  mesAnterior(): void {
    this.mes.update((m) => moverMes(m, -1));
  }

  mesSiguiente(): void {
    if (this.esMesActual()) return;
    this.mes.update((m) => moverMes(m, 1));
  }

  irARegistrar(): void {
    void this.router.navigate(['/tabs/tab1']);
  }

  cambiarFiltro(valor: unknown): void {
    const v = String(valor ?? 'todos');
    if (v !== this.filtro()) this.filtro.set(v);
  }

  async abrirConfiguracion(): Promise<void> {
    const modal = await this.modales.create({
      component: ConfigPresupuestoModalComponent,
      componentProps: { config: this.config() },
    });
    await modal.present();
    const { data, role } = await modal.onDidDismiss<Partial<ConfiguracionUsuario>>();
    if (role !== 'guardar' || !data) return;
    if (data.presupuestoMensual !== this.config().presupuestoMensual) {
      data.alertaPresupuestoMostradaEn = undefined; // nuevo tope: la alerta puede volver a salir
    }
    try {
      await this.datos.guardarConfig(data);
      await this.aviso('✓ Presupuesto actualizado');
    } catch {
      await this.aviso('No se pudo guardar el presupuesto. Inténtalo de nuevo.');
    }
  }

  async verRecibo(g: GastoItem): Promise<void> {
    const modal = await this.modales.create({
      component: VisorReciboModalComponent,
      componentProps: { gasto: g },
      cssClass: 'modal-visor',
    });
    await modal.present();
  }

  async editar(g: GastoItem, fila: IonItemSliding): Promise<void> {
    await fila.close();
    await this.router.navigate(['/tabs/tab1'], { queryParams: { editar: g.id } });
  }

  async eliminar(g: GastoItem, fila: IonItemSliding): Promise<void> {
    await fila.close();
    const alerta = await this.alertas.create({
      header: '¿Eliminar gasto?',
      message: g.fotoNombreArchivo
        ? `Se eliminará "${g.comercio}" y también la foto del recibo guardada en el celular.`
        : `Se eliminará "${g.comercio}".`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Eliminar', role: 'destructive' },
      ],
    });
    await alerta.present();
    const { role } = await alerta.onDidDismiss();
    if (role === 'destructive') await this.ejecutarEliminacion(g);
  }

  private async ejecutarEliminacion(g: GastoItem): Promise<void> {
    try {
      await this.datos.eliminarGasto(g.id);
    } catch {
      await this.aviso('No se pudo eliminar el gasto. Inténtalo de nuevo.');
      return;
    }
    const toast = await this.toasts.create({
      message: 'Gasto eliminado',
      duration: 4000,
      position: 'top',
      buttons: [{ text: 'Deshacer', role: 'deshacer' }],
    });
    await toast.present();
    const { role } = await toast.onDidDismiss();
    if (role === 'deshacer') {
      await this.datos.guardarGasto(g);
      await this.aviso('✓ Gasto restaurado');
    } else {
      // La foto solo se borra cuando ya no se puede deshacer
      await this.archivos.eliminar(g.fotoNombreArchivo);
    }
  }

  private async aviso(mensaje: string): Promise<void> {
    const t = await this.toasts.create({ message: mensaje, duration: 2000, position: 'top' });
    await t.present();
  }
}

import { Component, Input, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  AlertController,
  IonAccordion,
  IonAccordionGroup,
  IonButton,
  IonButtons,
  IonContent,
  IonFooter,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonSelect,
  IonSelectOption,
  IonTitle,
  IonToolbar,
  ModalController,
} from '@ionic/angular';

import { ConfiguracionUsuario, TIPOS_DEDUCIBLES, TipoDeducible } from '../../models/gasto.model';
import { esCorreoValido } from '../../services/almacenamiento.service';
import { CampoDineroComponent } from '../campo-dinero/campo-dinero.component';

/** Modal para definir el tope mensual, el año fiscal activo, el contador y los topes anuales. */
@Component({
  selector: 'app-config-presupuesto-modal',
  templateUrl: './config-presupuesto-modal.component.html',
  styleUrls: ['./config-presupuesto-modal.component.scss'],
  imports: [
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonIcon,
    IonContent,
    IonList,
    IonItem,
    IonInput,
    IonSelect,
    IonSelectOption,
    IonNote,
    IonLabel,
    IonAccordionGroup,
    IonAccordion,
    IonFooter,
    CampoDineroComponent,
  ],
})
export class ConfigPresupuestoModalComponent implements OnInit {
  private readonly modal = inject(ModalController);
  private readonly alertas = inject(AlertController);

  @Input({ required: true }) config!: ConfiguracionUsuario;

  readonly tipos = TIPOS_DEDUCIBLES;
  readonly anios: number[] = [];

  presupuesto: number | null = null;
  anioFiscal = new Date().getFullYear();
  correo = '';
  topes: Partial<Record<TipoDeducible, number | null>> = {};
  intentoGuardar = false;

  private inicial = '';

  get correoValido(): boolean {
    return !this.correo.trim() || esCorreoValido(this.correo);
  }

  async ngOnInit(): Promise<void> {
    const actual = new Date().getFullYear();
    for (let a = actual + 1; a >= actual - 4; a--) this.anios.push(a);
    this.presupuesto = this.config.presupuestoMensual || null;
    this.anioFiscal = this.config.anioFiscalActivo;
    this.correo = this.config.correoContador ?? '';
    this.topes = { ...(this.config.topesDeducibles ?? {}) };
    this.inicial = this.instantanea();

    // Cubre también el botón "atrás" de Android y el gesto de cerrar:
    // si hay cambios sin guardar, se pide confirmación.
    const elemento = await this.modal.getTop();
    if (elemento) {
      elemento.canDismiss = (_datos?: unknown, rol?: string) => this.puedeCerrar(rol);
    }
  }

  cerrar(): void {
    void this.modal.dismiss(null, 'cancel');
  }

  guardar(): void {
    this.intentoGuardar = true;
    if (!this.correoValido) return;
    const topes: Partial<Record<TipoDeducible, number>> = {};
    for (const t of this.tipos) {
      const v = this.topes[t.valor];
      if (v && v > 0) topes[t.valor] = v;
    }
    const cambios: Partial<ConfiguracionUsuario> = {
      presupuestoMensual: this.presupuesto ?? 0,
      anioFiscalActivo: this.anioFiscal,
      correoContador: this.correo.trim() || undefined,
      topesDeducibles: topes,
    };
    void this.modal.dismiss(cambios, 'guardar');
  }

  private instantanea(): string {
    return JSON.stringify([this.presupuesto, this.anioFiscal, this.correo.trim(), this.topes]);
  }

  private async puedeCerrar(rol?: string): Promise<boolean> {
    if (rol === 'guardar' || this.instantanea() === this.inicial) return true;
    const alerta = await this.alertas.create({
      header: '¿Salir sin guardar?',
      message: 'Los cambios del presupuesto se perderán.',
      buttons: [
        { text: 'Seguir editando', role: 'cancel' },
        { text: 'Salir sin guardar', role: 'destructive' },
      ],
    });
    await alerta.present();
    const { role } = await alerta.onDidDismiss();
    return role === 'destructive';
  }
}

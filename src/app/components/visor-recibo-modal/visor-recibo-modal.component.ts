import { Component, Input, OnInit, inject, signal } from '@angular/core';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonFooter,
  IonHeader,
  IonIcon,
  IonSpinner,
  IonTitle,
  IonToolbar,
  ModalController,
  ToastController,
} from '@ionic/angular';

import { fechaCorta } from '../../models/fechas';
import { GastoItem } from '../../models/gasto.model';
import { MonedaPipe } from '../../pipes/moneda.pipe';
import { ArchivosService } from '../../services/archivos.service';
import { ExportacionService } from '../../services/exportacion.service';

/** Modal a pantalla completa para leer el recibo con zoom táctil. */
@Component({
  selector: 'app-visor-recibo-modal',
  templateUrl: './visor-recibo-modal.component.html',
  styleUrls: ['./visor-recibo-modal.component.scss'],
  imports: [IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonIcon, IonContent, IonFooter, IonSpinner, MonedaPipe],
})
export class VisorReciboModalComponent implements OnInit {
  private readonly modal = inject(ModalController);
  private readonly toast = inject(ToastController);
  private readonly archivos = inject(ArchivosService);
  private readonly exportacion = inject(ExportacionService);

  /** Gasto a mostrar (puede ser un borrador que aún no se ha guardado). */
  @Input({ required: true }) gasto!: GastoItem;
  /** Si es true, no se muestra el botón compartir (borrador del Tab 1). */
  @Input() soloLectura = false;

  readonly url = signal<string | null>(null);
  readonly cargando = signal(true);
  readonly escala = signal(1);
  readonly despl = signal({ x: 0, y: 0 });
  readonly fechaCorta = fechaCorta;

  esPdf = false;

  private distanciaInicial = 0;
  private escalaInicial = 1;
  private ultimoToque = { x: 0, y: 0 };
  private ultimoTap = 0;

  async ngOnInit(): Promise<void> {
    this.esPdf = this.archivos.esPdf(this.gasto.fotoNombreArchivo);
    try {
      if (this.gasto.fotoNombreArchivo && !this.esPdf) {
        this.url.set(await this.archivos.obtenerUrl(this.gasto.fotoNombreArchivo));
      }
    } finally {
      this.cargando.set(false);
    }
  }

  cerrar(): void {
    this.modal.dismiss();
  }

  async compartir(): Promise<void> {
    try {
      await this.exportacion.compartirRecibo(this.gasto);
    } catch {
      const t = await this.toast.create({ message: 'No se pudo compartir el recibo', duration: 2000, position: 'top' });
      await t.present();
    }
  }

  acercar(): void {
    this.fijarEscala(this.escala() + 0.5);
  }

  alejar(): void {
    this.fijarEscala(this.escala() - 0.5);
  }

  // ----- Gestos táctiles: pellizco para zoom, arrastre para mover, doble toque -----

  alTocar(ev: TouchEvent): void {
    if (ev.touches.length === 2) {
      this.distanciaInicial = distancia(ev.touches[0], ev.touches[1]);
      this.escalaInicial = this.escala();
    } else if (ev.touches.length === 1) {
      this.ultimoToque = { x: ev.touches[0].clientX, y: ev.touches[0].clientY };
      const ahora = Date.now();
      if (ahora - this.ultimoTap < 300) {
        this.fijarEscala(this.escala() > 1 ? 1 : 2.5);
      }
      this.ultimoTap = ahora;
    }
  }

  alMover(ev: TouchEvent): void {
    if (ev.touches.length === 2 && this.distanciaInicial > 0) {
      ev.preventDefault();
      const d = distancia(ev.touches[0], ev.touches[1]);
      this.fijarEscala((this.escalaInicial * d) / this.distanciaInicial);
    } else if (ev.touches.length === 1 && this.escala() > 1) {
      ev.preventDefault();
      const t = ev.touches[0];
      const dx = t.clientX - this.ultimoToque.x;
      const dy = t.clientY - this.ultimoToque.y;
      this.ultimoToque = { x: t.clientX, y: t.clientY };
      const s = this.escala();
      this.despl.update((p) => ({ x: p.x + dx / s, y: p.y + dy / s }));
    }
  }

  alSoltar(): void {
    this.distanciaInicial = 0;
  }

  private fijarEscala(valor: number): void {
    const s = Math.min(5, Math.max(1, valor));
    this.escala.set(s);
    if (s === 1) this.despl.set({ x: 0, y: 0 });
  }
}

function distancia(a: Touch, b: Touch): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

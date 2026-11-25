import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { IonIcon, IonThumbnail } from '@ionic/angular';

import { GastoItem, iconoCategoria } from '../../models/gasto.model';
import { ArchivosService } from '../../services/archivos.service';

/** Miniatura del recibo; si no hay foto muestra el ícono de la categoría. */
@Component({
  selector: 'app-miniatura-recibo',
  imports: [IonThumbnail, IonIcon],
  template: `
    <ion-thumbnail class="miniatura" [class.sin-soporte]="!gasto().fotoNombreArchivo">
      @if (url()) {
        <img [src]="url()" alt="" />
      } @else {
        <div class="icono">
          <ion-icon [name]="icono()" aria-hidden="true"></ion-icon>
        </div>
      }
    </ion-thumbnail>
  `,
  styles: `
    .miniatura {
      --size: 52px;
      --border-radius: 12px;
      overflow: hidden;
      border-radius: 12px;
      border: 1px solid var(--app-gris-lila);
    }
    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .icono {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--app-superficie-suave);
      color: var(--app-morado);
      font-size: 24px;
    }
    .sin-soporte {
      border-style: dashed;
    }
    @media (prefers-color-scheme: dark) {
      .icono {
        color: var(--app-azul-lavanda);
      }
    }
  `,
})
export class MiniaturaReciboComponent {
  private readonly archivos = inject(ArchivosService);

  readonly gasto = input.required<GastoItem>();
  readonly url = signal<string | null>(null);
  readonly icono = computed(() =>
    this.archivos.esPdf(this.gasto().fotoNombreArchivo) ? 'document-outline' : iconoCategoria(this.gasto().categoria),
  );

  constructor() {
    effect(() => {
      const nombre = this.gasto().fotoNombreArchivo;
      this.url.set(null);
      if (!nombre || this.archivos.esPdf(nombre)) return;
      this.archivos
        .obtenerUrl(nombre)
        .then((u) => {
          if (this.gasto().fotoNombreArchivo === nombre) this.url.set(u);
        })
        .catch(() => this.url.set(null));
    });
  }
}

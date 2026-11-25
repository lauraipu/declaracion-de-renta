import { Component, computed, input, model } from '@angular/core';
import { IonInput } from '@ionic/angular';

import { aPesosEnteros, conMiles } from '../../utils/dinero';

/**
 * Campo de dinero en pesos colombianos:
 * - abre el teclado numérico,
 * - formatea miles mientras se escribe ("150.000"),
 * - acepta texto pegado ("$ 45.900") y descarta negativos/decimales/letras,
 * - expone siempre un número entero limpio en [(valor)].
 */
@Component({
  selector: 'app-campo-dinero',
  imports: [IonInput],
  template: `
    <ion-input
      [label]="label()"
      labelPlacement="stacked"
      type="text"
      inputmode="numeric"
      autocomplete="off"
      enterkeyhint="next"
      [placeholder]="placeholder()"
      [value]="texto()"
      (ionInput)="alEscribir($any($event).detail.value, $any($event).target)"
      [errorText]="errorText()"
      [helperText]="ayuda()"
      [class.ion-touched]="mostrarError()"
      [class.ion-invalid]="mostrarError()"
    >
      <span slot="start" class="prefijo" aria-hidden="true">$</span>
    </ion-input>
  `,
  styles: `
    :host {
      display: block;
      width: 100%;
    }
    .prefijo {
      margin-inline-end: 6px;
      font-weight: 600;
      color: var(--ion-color-primary);
    }
  `,
})
export class CampoDineroComponent {
  readonly label = input.required<string>();
  readonly placeholder = input('0');
  readonly errorText = input('');
  readonly ayuda = input<string | undefined>(undefined);
  readonly mostrarError = input(false);

  /** Pesos enteros o null si está vacío. */
  readonly valor = model<number | null>(null);
  readonly texto = computed(() => conMiles(this.valor()));

  alEscribir(crudo: string | null | undefined, campo: HTMLIonInputElement): void {
    const pesos = aPesosEnteros(crudo ?? '');
    this.valor.set(pesos);
    // Reescribe el campo ya formateado aunque el valor numérico no haya cambiado
    // (p. ej. si el usuario escribió una letra, que se elimina).
    campo.value = conMiles(pesos);
  }
}

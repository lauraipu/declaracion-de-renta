import { Component, inject } from '@angular/core';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonTitle,
  IonToolbar,
  ModalController,
} from '@ionic/angular';

/** Hoja de ayuda (breakpoints 0 / 0.65 / 1) sobre qué soportes guardar. */
@Component({
  selector: 'app-guia-renta-modal',
  imports: [IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonIcon, IonContent, IonList, IonItem, IonLabel, IonNote],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-button (click)="cerrar()" aria-label="Cerrar guía">
            <ion-icon slot="icon-only" name="close-outline" aria-hidden="true"></ion-icon>
          </ion-button>
        </ion-buttons>
        <ion-title>Guía rápida</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <p>
        Durante el año guarda aquí los soportes que tu contador suele pedir para la declaración de renta. Estos son los
        más comunes en Colombia:
      </p>
      <ion-list lines="full">
        @for (s of soportes; track s.titulo) {
          <ion-item>
            <ion-icon slot="start" [name]="s.icono" color="primary" aria-hidden="true"></ion-icon>
            <ion-label class="ion-text-wrap">
              <h3>{{ s.titulo }}</h3>
              <p>{{ s.texto }}</p>
            </ion-label>
          </ion-item>
        }
      </ion-list>
      <h3>Consejos</h3>
      <ul>
        <li>Pide siempre la factura electrónica <strong>a tu nombre y con tu cédula</strong>.</li>
        <li>Toma la foto con buena luz y que se lea el total, la fecha y el NIT del comercio.</li>
        <li>Los certificados anuales (bancos, prepagada) llegan entre enero y marzo: adjúntalos como "Otro soporte".</li>
      </ul>
      <ion-note>
        Esta guía es informativa y no reemplaza la asesoría de un contador. Los topes y porcentajes cambian cada año
        (se expresan en UVT); confírmalos con tu contador o en dian.gov.co.
      </ion-note>
    </ion-content>
  `,
  styles: `
    ion-note {
      display: block;
      margin: 16px 0 32px;
      line-height: 1.4;
    }
    li {
      margin-bottom: 8px;
    }
  `,
})
export class GuiaRentaModalComponent {
  private readonly modal = inject(ModalController);

  readonly soportes = [
    {
      icono: 'receipt-outline',
      titulo: 'Facturas electrónicas a tu nombre',
      texto: 'Compras pagadas con tarjeta o medios electrónicos pueden dar una deducción del 1 % (con tope).',
    },
    {
      icono: 'medkit-outline',
      titulo: 'Medicina prepagada y seguros de salud',
      texto: 'Guarda el certificado anual de pagos que expide la entidad.',
    },
    {
      icono: 'home-outline',
      titulo: 'Intereses de crédito de vivienda',
      texto: 'El banco expide un certificado con los intereses pagados en el año (hipoteca o leasing habitacional).',
    },
    {
      icono: 'people-outline',
      titulo: 'Dependientes',
      texto: 'Registro civil o soportes de hijos, cónyuge o padres que dependan económicamente de ti.',
    },
    {
      icono: 'school-outline',
      titulo: 'Educación',
      texto: 'Por ejemplo, certificado de intereses de créditos educativos (ICETEX). Confirma con tu contador si aplica.',
    },
  ];

  cerrar(): void {
    this.modal.dismiss();
  }
}

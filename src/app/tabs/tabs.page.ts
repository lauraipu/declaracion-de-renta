import { Component, EnvironmentInjector, computed, inject } from '@angular/core';
import { IonBadge, IonIcon, IonLabel, IonTabBar, IonTabButton, IonTabs } from '@ionic/angular';

import { AlmacenamientoService } from '../services/almacenamiento.service';

@Component({
  selector: 'app-tabs',
  templateUrl: 'tabs.page.html',
  styleUrls: ['tabs.page.scss'],
  imports: [IonTabs, IonTabBar, IonTabButton, IonIcon, IonLabel, IonBadge],
})
export class TabsPage {
  public environmentInjector = inject(EnvironmentInjector);
  private readonly datos = inject(AlmacenamientoService);

  /** Porcentaje del presupuesto del mes actual (para el badge del Tab 2). */
  readonly porcentaje = computed(() => Math.round(this.datos.porcentajeMesActual()));
  readonly mostrarBadge = computed(() => this.porcentaje() >= 80);
}

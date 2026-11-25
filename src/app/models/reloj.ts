import { computed, signal } from '@angular/core';
import { App } from '@capacitor/app';

import { isoLocal } from './fechas';

/**
 * "Hoy" reactivo (YYYY-MM-DD en hora local del celular).
 * Las pestañas de Ionic viven días en memoria: si "hoy" se calculara una sola vez,
 * después de medianoche o del cambio de mes los cálculos quedarían congelados.
 */
export const hoy = signal(isoLocal().substring(0, 10));
export const mesHoy = computed(() => hoy().substring(0, 7));

function refrescar(): void {
  const valor = isoLocal().substring(0, 10);
  if (valor !== hoy()) hoy.set(valor);
}

setInterval(refrescar, 60_000);
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', refrescar);
}
App.addListener('resume', refrescar).catch(() => undefined);

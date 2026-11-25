# Gastos y Renta

Aplicación móvil desarrollada con Ionic y Angular para registrar gastos, adjuntar recibos y organizar los soportes deducibles de la declaración de renta.

## Funcionalidades

- Registro y edición de gastos por mes y categoría.
- Configuración de presupuesto mensual y seguimiento del gasto disponible.
- Captura, carga y consulta de fotos o PDF como soportes.
- Lectura automática de datos del recibo mediante OCR.
- Clasificación de gastos deducibles y organización por rubro tributario.
- Resumen anual y detección de soportes fotográficos faltantes.
- Exportación de información tributaria.
- Almacenamiento local en el dispositivo.

## Tecnologías

- Angular
- Ionic Framework
- TypeScript
- Capacitor
- OCR con ML Kit
- Vitest y Playwright

## Requisitos

- Node.js
- npm
- Android Studio para ejecutar una versión Android

## Instalación

```bash
npm install
npm start
```

Para compilar la aplicación web:

```bash
npm run build
```

## Android

Después de compilar el proyecto, sincroniza Capacitor:

```bash
npx cap sync android
npx cap open android
```

## Pruebas

```bash
npm run test:unit
npm run test:e2e
npm run lint
```

## Nota

La aplicación organiza información y soportes, pero no reemplaza el asesoramiento de un contador ni determina obligaciones tributarias definitivas.

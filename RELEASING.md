# Publicar una versión (Releases)

Databara se distribuye vía **GitHub Releases**. Los instaladores de macOS, Linux y Windows se
construyen automáticamente en GitHub Actions (`.github/workflows/release.yml`) cuando se empuja un tag
de versión. Tauri no permite cross-compilar, por eso cada SO se construye en su propio runner.

Los usuarios descargan desde: <https://github.com/ClaudioGuevaraDev/databara-app/releases>

## Requisito único: generar el set de íconos

El bundle de macOS necesita `icon.icns` y el de Linux necesita PNGs; hoy el repo solo trae
`icon.ico`. **Antes del primer release** hay que generar el set completo una sola vez:

1. Coloca una imagen fuente cuadrada de alta resolución (idealmente **1024×1024 PNG**, fondo
   transparente) en `src-tauri/icons/source.png`.
2. Genera todos los formatos:
   ```bash
   pnpm tauri icon src-tauri/icons/source.png
   ```
   Esto crea en `src-tauri/icons/`: `icon.icns`, `icon.ico`, `32x32.png`, `128x128.png`,
   `128x128@2x.png`, `icon.png` y los recursos de Windows Store.
3. Actualiza `bundle.icon` en `src-tauri/tauri.conf.json` para referenciar el set completo:
   ```json
   "icon": [
     "icons/32x32.png",
     "icons/128x128.png",
     "icons/128x128@2x.png",
     "icons/icon.icns",
     "icons/icon.ico"
   ]
   ```
4. Commitea los íconos generados y el cambio de config.

## Flujo de release

1. **Sube la versión** en los tres manifiestos (deben quedar sincronizados):
   - `package.json` → `version`
   - `src-tauri/Cargo.toml` → `version`
   - `src-tauri/tauri.conf.json` → `version`
   - El skill `/conventional-commit` hace este bump automáticamente.
2. **Commit y push** a `main`.
3. **Crea y empuja el tag** con el prefijo `v`:
   ```bash
   git tag v0.10.1
   git push origin v0.10.1
   ```
4. GitHub Actions crea un release en borrador, construye los 3 SO subiendo cada bundle a ese mismo
   borrador y, cuando los tres terminan, el job `publish-release` **lo publica solo**. Sigue el
   progreso en la pestaña **Actions** del repo.
5. Al terminar el workflow la versión **ya está publicada**: no hay paso manual, y el updater empieza
   a ofrecerla a todo el que tenga la app instalada. Si quieres una ventana para revisar el borrador
   antes de que salga, hay que quitar el job `publish-release` de
   `.github/workflows/release.yml` (o condicionarlo, p. ej. a que el tag no lleve sufijo) y publicar a
   mano desde **Releases**.

> [!IMPORTANT]
> Empujar el tag equivale a publicar. Todo lo que quieras comprobar en un build de release —
> ejecutar la app, revisar los instaladores — hazlo **antes** del `git push origin vX.Y.Z`, con
> `pnpm tauri build` en local.

### Artefactos generados

| SO      | Archivos                                                  |
| ------- | --------------------------------------------------------- |
| Windows | `-setup.exe` (NSIS) — sin MSI, ver nota abajo             |
| macOS   | `.dmg` / `.app` (binario universal Intel + Apple Silicon) |
| Linux   | `.deb`, `.rpm`, `.AppImage`                               |

## Auto-actualización (in-app)

La app usa el plugin oficial **`tauri-plugin-updater`**: al abrir (y con el botón **"Buscar
actualizaciones"** del header) consulta el último release **publicado**, y si hay una versión nueva
la descarga, instala y reinicia mostrando un modal con el progreso.

### Requisito único: clave de firma del updater

El updater **exige** que los binarios estén firmados con una clave propia (independiente del code
signing de Windows/macOS). Generarla **una sola vez**:

1. Generar el par de claves localmente:
   ```bash
   pnpm tauri signer generate -w databara-updater.key
   ```
   Imprime una **clave pública** y crea la **clave privada** (pidiendo una contraseña).
2. Pegar la **clave pública** en `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`
   (reemplaza el placeholder `REEMPLAZAR_CON_LA_CLAVE_PUBLICA_...`).
3. Cargar como **secrets** del repo (Settings → Secrets and variables → Actions):
   - `TAURI_SIGNING_PRIVATE_KEY` → contenido de `databara-updater.key`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` → la contraseña elegida
4. **Nunca** commitear la clave privada. Guárdala en un lugar seguro.

### Cómo funciona en CI

Con `bundle.createUpdaterArtifacts: true` (ya configurado) y los dos secrets de arriba,
`tauri-action` firma los bundles y **genera/sube `latest.json`** al release automáticamente
(lo mergea entre los 3 runners). No hay pasos manuales extra.

### Importante

- El endpoint apunta al **último release publicado**. Como el workflow crea releases en **borrador**,
  los usuarios reciben la actualización **recién al publicar** el release.
- El mecanismo funciona **hacia adelante**: usuarios con una versión anterior a la primera que
  incluyó el plugin deben actualizar manualmente una vez.

#### Windows: solo NSIS (sin MSI)

El bundle de Windows produce **solo el `-setup.exe` (NSIS)**, no `.msi`. Motivo: MSI y NSIS instalan
en rutas/registro distintos, así que actualizar un MSI con el instalador NSIS del updater dejaba
**dos apps instaladas**. Con NSIS la instalación inicial y la actualización usan el mismo mecanismo
y se reemplaza en sitio (`installMode: currentUser`, sin permisos de admin).

> Si un usuario tenía la app instalada vía MSI, debe **desinstalar todas las copias** y reinstalar
> con el `-setup.exe` una vez; a partir de ahí el auto-update reemplaza en sitio.

#### Linux: solo AppImage se auto-actualiza

El updater reemplaza el archivo `.AppImage` en su sitio, por lo que necesita **permiso de escritura**
sobre ese archivo. Requisitos para que funcione:

- Ejecutar el **`.AppImage`** desde una carpeta **escribible por el usuario** (ej. `~/Applications`,
  `~/Descargas`), no desde una ruta del sistema.
- Las instalaciones por **`.deb`/`.rpm`** **no** se auto-actualizan (las maneja el gestor de paquetes
  con root) → dan "permiso denegado". Esos usuarios actualizan con su gestor de paquetes.

## Sin firma de código

Los instaladores se publican **sin firmar** (no configurado por ahora):

- **macOS**: al abrir aparece la advertencia de Gatekeeper. El usuario abre con **clic derecho →
  Abrir**, o ejecuta `xattr -dr com.apple.quarantine /Applications/Databara.app`.
- **Windows**: SmartScreen muestra un aviso → **Más información → Ejecutar de todos modos**.
- **Linux**: no se firma; es el comportamiento normal.

Para firmar más adelante (opcional, de pago):

- **macOS**: Apple Developer Program (99 USD/año) + notarización. Descomenta las variables `APPLE_*`
  en el workflow y agrégalas como _secrets_ del repo.
- **Windows**: certificado de code signing (OV ~100-300 USD/año con token, o Azure Trusted Signing
  ~10 USD/mes). Descomenta las variables `TAURI_SIGNING_*`.

## Build local (opcional)

Para probar el instalador de tu propio SO sin pasar por CI:

```bash
pnpm tauri build            # instaladores del SO actual
pnpm tauri build --no-bundle # solo el binario, sin empaquetar
```

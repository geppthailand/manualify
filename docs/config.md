# Config (`manualify.config.mjs`)

Searched upward from the script, then the current directory. Every key is optional except `baseURL`.

| Key | Default | |
|---|---|---|
| `baseURL` | `http://localhost:3000` | where the app runs |
| `viewport` | `{width:1920,height:1080}` | CSS px |
| `scale` | `1.5` | device scale factor; recording = viewport × scale; also the max sharp zoom |
| `fps`, `chunkSeconds` | `30`, `10` | |
| `encoder` | `libx264` | `h264_videotoolbox` on macOS for hardware encoding |
| `locale`, `timezoneId`, `colorScheme` | `en-US`, –, `light` | |
| `readingSpeed` | `14` | caption characters per second |
| `outDir` | `manualify-out` | |
| `assert` | `warn` | default for scripts without `@assert` |
| `locateTimeout` | `8000` | ms per target |
| `allow` | `[]` | extra hosts the page may reach; everything else is blocked (`*.example.com` works) |
| `routes` | `[]` | `{url, json | file | status, body}` canned responses (glob URLs) |
| `login(page, user, ctx)` | – | runs before scripts with `@user` (or `defaultUser`) |
| `users` | `{}` | handed to `login` |
| `ready(page)` | network idle | what `wait ready` means |
| `state.restore(name)` | – | for `@state` |
| `macros` | `{}` | `name: (scope, value, {page, fuzzy}) => Locator` |
| `pick(page, locator, option, helpers)` | built-in | custom dropdown widget |
| `hooks` | `{}` | `name: async (page, ctx, ...args)` for `run name args` |
| `i18n` | – | map or function for `t:key` targets |
| `captions` | see source | `size, font, color, background, bold, radius, maxWidth, band` |
| `chip` | | `background, color, size, position (top-center|top-left|top-right), seconds` |
| `theme` | `{accent:'#f5a524'}` | highlight boxes and ripples |
| `cards` | – | `{logo, background, color}` → title card from `@title`/`@subtitle` |
| `output` | `{width:1920}` | rendered width (height follows the viewport aspect) |
| `trimIdle` | `0` | squeeze idle stretches longer than N s |

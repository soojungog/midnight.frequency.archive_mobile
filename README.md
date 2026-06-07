# MIDNIGHT FREQUENCY ARCHIVE Mobile

Start the local server, then open the URL in a mobile browser or desktop browser:

```powershell
cd E:\sujeong\codex\midnight.frequency.archive_mobile
& "C:\Users\sujeong\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" .\start-mobile-server.cjs
```

Open:

```text
http://127.0.0.1:4177
```

For a phone on the same Wi-Fi, replace `127.0.0.1` with your PC's local IP address.

You can edit:

- background image
- album images 1-6
- brand, intro, outro, track titles, track artists
- intro/album/outro timing

The app stores edits in the current browser with `localStorage`.

Render from the `Render` tab. Chrome usually exports MP4. If MP4 is unavailable, it exports WebM.

Default timing:

- Intro: 2s
- Each album: 10s
- Outro: 2s

// Pod: the sidecar script is bundled as text (Vite's ?raw import) and handed to Python
// through -c, so the packaged app needs no extra resource file.
declare module '*.py?raw' {
  const text: string
  export default text
}

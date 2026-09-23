import { readFile, writeFile } from "node:fs/promises";
const root = new URL("../", import.meta.url);
const html = await readFile(new URL("registration/index.html", root), "utf8");
const css = await readFile(new URL("registration/form.css", root), "utf8");
const js = await readFile(new URL("registration/form.js", root), "utf8");
const template = html
  .replace('<link rel="stylesheet" href="./form.css">', "<?!= include_('Styles'); ?>")
  .replace("<!-- APPS_SCRIPT_BOOTSTRAP -->", "<script>window.REGISTRATION_BOOTSTRAP = <?!= bootstrap ?>;</script>")
  .replace(/^[ \t]*<script src="\.\/form\.js" defer><\/script>[ \t]*\r?\n/m, "")
  .replace("</body>", "<?!= include_('Client'); ?>\n</body>");
await writeFile(new URL("apps-script/Index.html", root), template);
await writeFile(new URL("apps-script/Styles.html", root), "<style>\n" + css + "\n</style>\n");
await writeFile(new URL("apps-script/Client.html", root), "<script>\n" + js + "\n</script>\n");
console.log("Apps Script files generated: Index.html, Styles.html, Client.html");

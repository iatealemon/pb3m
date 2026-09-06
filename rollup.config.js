import resolve from "@rollup/plugin-node-resolve";
import importAsString from "rollup-plugin-string-import";
import commonjs from "@rollup/plugin-commonjs";
import license from "rollup-plugin-license";
import pkg from "./package.json" with { type: "json"};
import url from "node:url";
import path from "node:path";
import fs from "node:fs";
import userscriptHeaders from "./userscript-headers.js";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MAIN_OUTPUT_FILE_NAME = "pb3m.user.js";

const LICENSES_PATH = path.join(__dirname, "dist", "LICENSES.txt");

/**
 * adds a banner containing userscript headers and third-party licenses. 
 * also emits the .meta.js file  
 * 
 * can't use output.banner to write the userscript headers and license plugin banner  
 * option to write the licenses because the license plugin adds its banner using 
 * renderChunk which runs after output.banner has already been added, causing 
 * them to appear before the userscript headers.
 */
const myPostProcessPlugin = {
    name: "my-post-process",
    generateBundle: {
        order: "post",
        async handler(outputOptions, bundle) {
            let licensesText = "";
            try {
                licensesText = await fs.promises.readFile(LICENSES_PATH, "utf-8");
            }
            catch (e) {
                this.error(`Failed to read ${LICENSES_PATH}`);
            }

            const licenseComment = 
                "/*!\n" + 
                " * Licenses:\n" +
                " * \n" +
                licensesText.split("\n").map(L => ` * ${L}\n`).join("") + 
                " */\n";
            
            const chunk = Object.values(bundle).find(asset => asset.type === "chunk" && asset.fileName.endsWith(".user.js"));
            if (chunk === undefined)
                this.error("Failed to find userscript chunk");

            chunk.code = userscriptHeaders + "\n\n" + licenseComment + "\n" + chunk.code;

            this.emitFile({
                type: "asset",
                fileName: chunk.fileName.replace(/\.user\.js$/, ".meta.js"),
                source: userscriptHeaders,
            });
        },
    },
}

export default [
    {
        input: "src/main.js",
        output: {
            file: `dist/${MAIN_OUTPUT_FILE_NAME}`,
            format: "es",
            //banner: userscriptHeaders,
        },
        plugins: [
            resolve(),
            importAsString({ include: ["**/*.raw.*"], }), // must be before commonjs
            license({
                thirdParty: {
                    output: {
                        file: LICENSES_PATH,
                    },
                    includeSelf: true,
                },
            }),
            /*license({
                banner: {
                    content: {
                        file: LICENSES_PATH,
                    },
                },
            }),*/
            commonjs(),
            myPostProcessPlugin,
        ],
    },
];
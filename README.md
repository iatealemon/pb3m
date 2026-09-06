# PB3 Monaco editor

This is a userscript that aims to improve the PB3 script editor. It does this by swapping the Ace editor to the Monaco editor and providing type declarations so you can write scripts knowing what's what and what you can use and how.

The PB3 script environment types are fetched from a separate repository at https://github.com/iatealemon/typed-pb3. Contributions are welcome.

Bundled using Rollup, so the bundled userscript code remains readable and you can modify it if you wish.

You can find the changelog [here](https://github.com/iatealemon/typed-pb3/blob/main/CHANGELOG.md).

## How to install
PB3M can be used with Tampermonkey. You can download Tampermonkey from [here](https://www.tampermonkey.net/), then once you have installed Tampermonkey, you can download PB3M by clicking [here](https://github.com/iatealemon/pb3m/raw/main/dist/pb3m.user.js).

## To-do
- Types and documentation for the PB3 script environment. Most types are currently shown as "any" because they're to-do. Replacing them with their real types requires testing and code reading. You may contribute by sending a message on Discord or making a pull request on the typed-pb3 repository.
- Hiding inaccessible code things such as "document" from suggestions. The only way to remove these declarations is to generate a new set of typescript lib declarations with these inaccessible items omitted. I tried it but it wasn't happening so I opted to keep them and show a warning when trying to use them. Unfortunately this means that suggestions on the global scope are not so useful.
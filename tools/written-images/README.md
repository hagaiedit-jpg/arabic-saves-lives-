# Written-Arabic recognition images (📷 זיהוי חזותי)

Generated reconstructions shown on the visual-recognition cards until
authentic field photos replace them. Output: `img/written/<slug>.jpg`.

Regenerate (after editing the JOBS list / templates in `gen.html`):

    cd tools/written-images
    npm install playwright-core@1 @fontsource/cairo @fontsource/lalezar @fontsource/reem-kufi
    node gen.js

To use an authentic photo instead: overwrite `img/written/<slug>.jpg` with a
photo of the same name (≈800×560, JPEG), or add `img:<url>` to that phrase's
`tags` field in the admin — a tagged URL wins over the built-in file.
Blur faces and licence plates; never use a real person's ID.

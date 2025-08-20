# Tileset for Permadeth (client/assets/tiles.png)

You can drop a sprite sheet here to replace the procedural ground.

**Requirements**
- File path: `client/assets/tiles.png`
- Each tile is **64×64** pixels (same as server TILE_SIZE).
- Arrange tiles in a grid (e.g., 8×8).
- **Convention (simple):**
  - The **first half** of frames are grass variants.
  - The **second half** are dirt variants.

The client will automatically detect this file and cut it into frames. If the file is missing, it falls back to a procedural grass/dirt mix.

// Per-board serialization of ordering-sensitive writes (task create/move/delete, column changes).
// `SELECT ... FOR UPDATE` on every column row of the board, in id order (deadlock-free), blocks
// concurrent transactions touching the same board until commit. Different boards never contend.
async function lockBoard(tx, boardId) {
  await tx.$queryRaw`SELECT id FROM columns WHERE board_id = ${boardId}::uuid ORDER BY id FOR UPDATE`;
}

// Re-number tasks 0..n-1 in a column; returns [{id, columnId, position}] for rows that changed.
async function compactColumn(tx, columnId) {
  const rows = await tx.task.findMany({ where: { columnId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], select: { id: true, position: true } });
  const changed = [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].position !== i) {
      await tx.task.update({ where: { id: rows[i].id }, data: { position: i } });
      changed.push({ id: rows[i].id, columnId, position: i });
    }
  }
  return changed;
}

module.exports = { lockBoard, compactColumn };

// utils/pdf_ciclos.js
// Gera PDF resumido de um ciclo (usado por /reports/cycle/:id)
// Recebe (ciclo, outputPath) e retorna Promise que resolve quando salvo.

const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

module.exports = async function gerarPDFCiclo(ciclo, outputPath) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 40 });
      const stream = fs.createWriteStream(outputPath);
      doc.pipe(stream);

      // Header
      doc.fontSize(18).fillColor("#0C69F6").text("Relatório de Ciclo", { align: "left" });
      doc.moveDown(0.2);
      doc.fontSize(10).fillColor("#333").text(`Ciclo ID: ${ciclo.id} — Digestor: ${ciclo.digestor_name || ciclo.digestor_id}`, { continued: false });
      doc.text(`Gerado em: ${new Date().toLocaleString()}`);
      doc.moveDown();

      // Section: TRITURAÇÃO
      doc.fontSize(14).fillColor("#000").text("Trituração", { underline: true });
      doc.moveDown(0.2);
      doc.fontSize(11).fillColor("#333");
      doc.text(`Início: ${ciclo.start_tritura_at || '—'}`);
      doc.text(`Término: ${ciclo.end_tritura_at || '—'}`);
      doc.text(`Toneladas solicitadas: ${ciclo.toneladas_solicitadas || '—'}`);
      doc.text(`Toneladas trituradas: ${ciclo.toneladas_trituradas || '—'}`);
      doc.moveDown();

      // Section: COZIMENTO
      doc.fontSize(14).fillColor("#000").text("Cozimento", { underline: true });
      doc.moveDown(0.2);
      doc.fontSize(11).fillColor("#333");
      doc.text(`Início: ${ciclo.start_cook_at || '—'}`);
      doc.text(`Término: ${ciclo.end_cook_at || '—'}`);
      doc.moveDown();

      // Section: DESCARGA
      doc.fontSize(14).fillColor("#000").text("Descarga", { underline: true });
      doc.moveDown(0.2);
      doc.fontSize(11).fillColor("#333");
      doc.text(`Toneladas descarregadas: ${ciclo.toneladas_discarded || '—'}`);
      if (ciclo.notes) {
        doc.moveDown(0.2);
        doc.text("Observações:");
        doc.text(ciclo.notes);
      }
      doc.moveDown();

      // Footer / metadata
      doc.fontSize(10).fillColor("#666");
      doc.text("Dados extraídos do sistema", { align: "left" });
      doc.moveDown(0.5);

      // finalize
      doc.end();

      stream.on("finish", () => resolve(outputPath));
      stream.on("error", (err) => reject(err));
    } catch (e) {
      reject(e);
    }
  });
};

// utils/pdf_portaria.js
// Gera um PDF com os dados de uma entrada do portaria
// Uso: gerarPDFPortaria(entry, outputPath) -> Promise

const PDFDocument = require("pdfkit");
const fs = require("fs");

module.exports = async function gerarPDFPortaria(entry, outputPath) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 36 });
      const stream = fs.createWriteStream(outputPath);
      doc.pipe(stream);

      doc.fontSize(18).fillColor("#0C69F6").text("Comprovante de Entrada - Portaria", { align: "center" });
      doc.moveDown();

      doc.fontSize(12).fillColor("#000");
      doc.text(`ID: ${entry.id || ''}`);
      doc.text(`Placa: ${entry.truck_plate || ''}`);
      doc.text(`Toneladas Declaradas: ${entry.toneladas_declared || ''}`);
      doc.text(`Toneladas Confirmadas: ${entry.toneladas_confirmed || ''}`);
      doc.text(`Status: ${entry.status || ''}`);
      doc.text(`Registrado por (user id): ${entry.portaria_user_id || ''}`);
      doc.text(`Chegada: ${entry.arrival_at || ''}`);

      if (entry.notes) {
        doc.moveDown();
        doc.fontSize(11).fillColor("#333").text("Observações:");
        doc.text(entry.notes);
      }

      doc.moveDown(1.2);
      doc.fontSize(10).fillColor("#666").text("Documento gerado pelo sistema Campo do Gado.");

      doc.end();

      stream.on("finish", () => resolve(outputPath));
      stream.on("error", (err) => reject(err));
    } catch (e) {
      reject(e);
    }
  });
};

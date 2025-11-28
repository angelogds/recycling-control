const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");

module.exports = async function gerarPDF(res, ciclo) {

    const doc = new PDFDocument();
    res.setHeader("Content-Type", "application/pdf");

    doc.pipe(res);

    doc.fontSize(20).text("Relatório do Ciclo - Digestor " + ciclo.digestor_id, { align: "center" });

    doc.moveDown();
    doc.fontSize(12).text("ID do Ciclo: " + ciclo.id);
    doc.text("Início: " + (ciclo.start_cycle_at || "-"));
    doc.text("Fim: " + (ciclo.end_cycle_at || "-"));

    doc.end();
};

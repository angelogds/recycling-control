// utils/pdf_ciclos.js
const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");

async function gerarPdfCiclo(cycle, outputPath) {
    return new Promise(async (resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 40 });
            const stream = doc.pipe(require("fs").createWriteStream(outputPath));

            // ------------------------------
            // Capa elegante
            // ------------------------------
            doc.rect(0, 0, doc.page.width, 120)
                .fill("#0a5728");

            doc.fillColor("#ffffff")
                .fontSize(26)
                .text("Relatório de Ciclo - Digestores", 40, 40);

            doc.moveDown(2);

            // ------------------------------
            // QRCode para autenticação
            // ------------------------------
            const qrData = `Ciclo ID: ${cycle.id} | Digestor: ${cycle.digestor_id} | Início: ${cycle.start_time}`;
            const qrImage = await QRCode.toDataURL(qrData);

            doc.image(Buffer.from(qrImage.split(",")[1], "base64"), doc.page.width - 160, 30, {
                fit: [120, 120]
            });

            doc.moveDown(3);

            // ------------------------------
            // Dados gerais
            // ------------------------------
            doc.fillColor("#0a5728")
                .fontSize(20)
                .text("Informações do Ciclo", { underline: true });

            doc.moveDown(1);

            doc.fillColor("#000000")
                .fontSize(12)
                .text(`ID do Ciclo: ${cycle.id}`)
                .text(`Digestor: ${cycle.digestor_id}`)
                .text(`Início: ${cycle.start_time}`)
                .text(`Término: ${cycle.end_time || "Em aberto"}`)
                .text(`Status Final: ${cycle.status}`)
                .moveDown(2);
doc.fontSize(14).text(`Matéria-prima: ${dados.materia_prima || "—"}`);

            // ------------------------------
            // Tabela do ciclo
            // ------------------------------
            doc.fillColor("#0a5728")
                .fontSize(18)
                .text("Etapas do Processo", { underline: true });

            doc.moveDown(1);

            const tableRows = [
                ["Etapa", "Horário de Início", "Horário de Fim", "Resultado"],
                ["Carregamento", cycle.load_start || "-", cycle.load_end || "-", cycle.load_result || "-"],
                ["Trituração", cycle.tritu_start || "-", cycle.tritu_end || "-", cycle.tr]()

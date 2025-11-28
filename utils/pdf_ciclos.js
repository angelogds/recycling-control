// utils/pdf_ciclos.js — PDF Premium PRO

const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const fs = require("fs");
const path = require("path");

// Caminho da pasta de relatórios
const REPORTS_DIR = path.join(__dirname, "..", "public", "reports");
if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

module.exports = async function gerarPDFCiclo(dados) {
    /*
        dados = {
            digestor: { id, nome, capacidade_tn },
            tritura: { id, toneladas_solicitadas, toneladas_trituradas, start, end },
            cook: { id, start, end },
            discharge: { toneladas_discarded, notes },
            operador: { nome },
            criado_em: "2025-01-01 10:30"
        }
    */

    const fileName = `ciclo_digestor_${dados.digestor.id}_${Date.now()}.pdf`;
    const filePath = path.join(REPORTS_DIR, fileName);

    const doc = new PDFDocument({
        size: "A4",
        margin: 40
    });

    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // ------------------------------------
    // CAPA PREMIUM
    // ------------------------------------
    doc
        .fillColor("#145A32")
        .fontSize(26)
        .font("Helvetica-Bold")
        .text("RELATÓRIO DE CICLO — DIGESTOR", { align: "center" })
        .moveDown(1);

    // LOGO
    const logoPath = path.join(__dirname, "..", "public", "img", "logo_menu_256.png");
    if (fs.existsSync(logoPath)) {
        doc.image(logoPath, doc.page.width / 2 - 60, 120, { width: 120 });
    }

    doc.moveDown(8);
    doc
        .fontSize(18)
        .text(`Digestor: ${dados.digestor.nome}`, { align: "center" })
        .moveDown(0.5)
        .text(`Capacidade: ${dados.digestor.capacidade_tn} toneladas`, { align: "center" })
        .moveDown(1)
        .fontSize(14)
        .text(`Relatório gerado em: ${dados.criado_em}`, { align: "center" });

    doc.addPage();

    // ------------------------------------
    // QR CODE
    // ------------------------------------
    const qrTexto = `Digestor: ${dados.digestor.nome}\nCiclo gerado em ${dados.criado_em}`;
    const qrData = await QRCode.toDataURL(qrTexto);

    doc.image(qrData, 400, 30, { width: 150 });

    // ------------------------------------
    // DADOS DO DIGESTOR
    // ------------------------------------
    doc.fontSize(20).fillColor("#1D8348").text("Dados do Digestor", { underline: true });
    doc.moveDown(1);

    doc.fontSize(13).fillColor("black");
    doc.text(`ID: ${dados.digestor.id}`);
    doc.text(`Nome: ${dados.digestor.nome}`);
    doc.text(`Capacidade: ${dados.digestor.capacidade_tn} tn`);
    doc.moveDown(1);

    // ------------------------------------
    // TABELA — TRITURAÇÃO
    // ------------------------------------
    doc.fontSize(18).fillColor("#1D8348").text("Ciclo de Trituração", { underline: true });
    doc.moveDown(0.8);

    const tabelaTrit = [
        ["Campo", "Valor"],
        ["ID Trituração", dados.tritura.id],
        ["Ton. Solicitadas", dados.tritura.toneladas_solicitadas + " tn"],
        ["Ton. Trituradas", dados.tritura.toneladas_trituradas + " tn"],
        ["Início", dados.tritura.start],
        ["Fim", dados.tritura.end]
    ];
    desenharTabela(doc, tabelaTrit);

    doc.addPage();

    // ------------------------------------
    // TABELA — COZIMENTO
    // ------------------------------------
    doc.fontSize(18).fillColor("#1D8348").text("Ciclo de Cozimento", { underline: true });
    doc.moveDown(0.8);

    const tabelaCook = [
        ["Campo", "Valor"],
        ["ID Cozimento", dados.cook.id],
        ["Início", dados.cook.start],
        ["Fim", dados.cook.end]
    ];
    desenharTabela(doc, tabelaCook);

    doc.moveDown(2);

    // ------------------------------------
    // TABELA — DESCARGA
    // ------------------------------------
    doc.fontSize(18).fillColor("#1D8348").text("Descarga", { underline: true });
    doc.moveDown(0.8);

    const tabelaDis = [
        ["Campo", "Valor"],
        ["Ton. Descarregadas", dados.discharge.toneladas_discarded + " tn"],
        ["Observações", dados.discharge.notes || "—"]
    ];
    desenharTabela(doc, tabelaDis);

    doc.moveDown(2);

    // ------------------------------------
    // ASSINATURA
    // ------------------------------------
    doc.fontSize(14).text("Assinatura do Operador:", { underline: true });
    doc.moveDown(3);
    doc.text(`${dados.operador.nome}`);
    doc.text("____________________________________");

    doc.end();

    return fileName;
};

// -------------------------------------------------------------
// Função para desenhar tabelas simples Premium
// -------------------------------------------------------------
function desenharTabela(doc, rows) {
    const col1 = 40;
    const col2 = 240;
    const rowHeight = 22;

    rows.forEach((r, i) => {
        const y = doc.y;

        // Fundo do cabeçalho
        if (i === 0) {
            doc.rect(col1 - 5, y - 3, 500, rowHeight)
               .fill("#D5F5E3")
               .fillColor("black");
        }

        doc.font("Helvetica-Bold").text(r[0], col1, y);
        doc.font("Helvetica").text(r[1], col2, y);

        doc.moveDown(1);
    });
}

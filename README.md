# Recycling Control - Sistema de Controle de Processo

## Instalação local
1. Clonar repo
2. `npm install`
3. Criar DB e seed: `npm run init-db`
4. Iniciar: `npm start` (ou `npm run dev`)

A aplicação roda em `http://localhost:3002` por padrão.

## Deploy
- Push para GitHub e configure Railway/Heroku.
- Se Railway: não se esqueça de rodar `npm run init-db` durante build ou usar um volume persistente.

## Estrutura
/...

## Documento base do processo
- Consulte `docs/BASE_SISTEMA_RECICLAGEM.md` para a especificação funcional detalhada do fluxo portaria → tova → trituração → cozimento → encerramento.

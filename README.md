# 🍷 Os Meus Vinhos

Aplicação web simples (PWA) para registar os vinhos que provo: foto do rótulo para identificação, atributos básicos e avaliação.

## Funcionalidades

- **Foto** — tirar foto com a câmara do telemóvel ou escolher da galeria (redimensionada automaticamente para poupar espaço).
- **Atributos** — nome, ano (colheita), tipo (tinto, branco, rosé, verde, espumante, porto…), produtor, região, país, castas, preço, data da prova, onde/com quem, notas e "voltaria a comprar".
- **Avaliação** de 1 a 5 estrelas.
- **Lista** com pesquisa, filtro por tipo e ordenação (recentes, melhor avaliados, ano, nome) e média das avaliações.
- **Funciona offline** e pode ser **instalada no ecrã inicial** do telemóvel.
- **Cópia de segurança** — exportar/importar tudo (incluindo fotos) num ficheiro JSON, pelo menu ⋮.

Os dados ficam guardados **apenas no próprio dispositivo** (IndexedDB do navegador). Não há servidor nem conta. Faça exportações regulares para não perder os registos se limpar os dados do navegador.

## Como usar

Não precisa de instalar nada nem de compilar — são ficheiros estáticos.

### Publicar no GitHub Pages (recomendado para usar no telemóvel)

1. No GitHub: **Settings → Pages**.
2. Em *Source* escolha **Deploy from a branch**, selecione o ramo e a pasta `/ (root)`.
3. Abra o endereço indicado (ex.: `https://<utilizador>.github.io/winelist/`) no telemóvel.
4. Para instalar: no Android/Chrome "Adicionar ao ecrã principal"; no iPhone/Safari *Partilhar → Adicionar ao ecrã principal*.

### Testar localmente

```bash
python3 -m http.server 8000
```

E abrir <http://localhost:8000>.

## Estrutura

| Ficheiro | Função |
|---|---|
| `index.html` | Estrutura da app (lista, detalhe, formulário) |
| `app.js` | Lógica: navegação, formulário, fotos, pesquisa, exportar/importar |
| `db.js` | Armazenamento local em IndexedDB |
| `styles.css` | Estilos (com modo escuro automático) |
| `sw.js` | Service worker para funcionar offline |
| `manifest.webmanifest`, `icon.svg` | Instalação como app |

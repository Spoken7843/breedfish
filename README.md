# Plantel · Guppy em óleo

Simulador de criação de guppy no navegador, com genética de verdade e visual pintado a óleo (WebGL2).

**Jogar:** https://spoken7843.github.io/breedfish/

## O que tem

- **46 variedades reais do hobby**, como HB Blue, Koi, Snakeskin, Dragon, Moscow, Full Red e Double Sword. Cada peixe é desenhado a partir do próprio genoma.
- **Genética:**
  - Recessivos (albino, blond, golden...).
  - Padrões de macho ligados ao X e ao Y.
  - Medidas de muitos genes (cauda, abertura, dorsal, cor, porte) que respondem à seleção aos poucos.
  - Defeitos escondidos que a endogamia expõe.
- **Dois modos, cada um com seu save:**
  - **Rápido:** cada cruzamento dá filhotes já adultos, na hora; ninguém cruza sem você mandar.
  - **Realista:** o plantel no tempo, abaixo.
- **Escolher no aquário:** toque num peixe nadando para ver quem é e usar como mãe ou pai. Cada card tem a foto do peixe.
- **Plantel no tempo (Realista):**
  - Aquários e lago com lotação, temperatura e comida.
  - Os peixes crescem, envelhecem e morrem.
  - A fêmea guarda esperma, e o pai fica incerto até o teste de paternidade.
- **Seleção:** ranking por nota e medidas, agrupar por cor, filtros por cor, padrão e ninhada, estatística do lote e rodadas de corte.
- **Desafios** e **troca de peixes por código:** quem colar o código recebe exatamente o mesmo peixe.

O plantel fica salvo no navegador de cada pessoa.

## Rodar localmente

Qualquer servidor estático na raiz, por exemplo `python -m http.server 8080`, e abra http://localhost:8080/.

## Aviso

A genética do jogo é uma simplificação para jogar. Muitos valores (dominância, taxas, curvas) são suposições de jogo e não um mapa genético validado. As fontes usadas estão citadas nos comentários de `core/species.mjs`.

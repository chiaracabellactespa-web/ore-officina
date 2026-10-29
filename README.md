# Ore Officina

App per registrare le ore lavorate in officina: ogni operaio sceglie il lavoro, fa partire il timer, segna le pause, i ricambi, le note e l'eventuale soccorso stradale. Il titolare vede in tempo reale chi sta lavorando e ottiene i report giornalieri e mensili per persona e per lavoro.

L'app si installa sulla schermata Home dello smartphone come una vera app. Più persone possono usarla insieme e far partire i timer anche sullo stesso lavoro.

Serve un account gratuito su **GitHub** (ospita l'app) e uno su **Supabase** (conserva i dati). Non serve saper programmare: bastano circa 20 minuti.

---

## Installazione

### 1. Crea il progetto Supabase

1. Vai su <https://supabase.com> e crea un account.
2. Premi **New project**. Dai un nome (per esempio `ore-officina`), scegli una password per il database (conservala) e come regione **Central EU (Frankfurt)**.
3. Attendi un paio di minuti che il progetto sia pronto.

### 2. Crea le tabelle

1. Nel menu a sinistra apri **SQL Editor** e premi **New query**.
2. Apri il file `supabase/schema.sql`, copia tutto il contenuto e incollalo nell'editor.
3. Premi **Run**. Deve comparire "Success".

### 3. Imposta il PIN del titolare

1. Nello SQL Editor apri una nuova query e incolla questa riga, sostituendo `1234` con il PIN che vuoi (da 4 a 6 cifre):

   ```sql
   select public.setup_owner_pin('1234');
   ```

2. Premi **Run**. Per cambiare il PIN in futuro lo fai dall'app, in Anagrafiche.

### 4. Copia le due chiavi nell'app

1. In Supabase apri **Project Settings** e poi **API**.
2. Copia il **Project URL** (inizia con `https://` e finisce con `.supabase.co`).
3. Copia la chiave **anon public** (è lunga e inizia con `eyJ`).
4. Apri il file `config.js` di questa cartella e incolla i due valori tra le virgolette.

Non usare mai la chiave `service_role`: quella è segreta. La chiave `anon` è pensata per stare nell'app. I dati restano protetti perché le tabelle non sono leggibili direttamente: si passa solo da funzioni che controllano PIN e ruolo.

### 5. Metti l'app su GitHub

1. Vai su <https://github.com>, accedi e premi **New repository**. Chiamalo per esempio `ore-officina` e lascialo **Public** (è necessario per GitHub Pages gratuito).
2. Nel repository premi **Add file** e poi **Upload files**.
3. Trascina dentro **tutto il contenuto** di questa cartella, comprese le cartelle `icons` e `supabase`, e premi **Commit changes**.
4. Apri **Settings**, poi **Pages**. Alla voce **Branch** scegli `main` e la cartella `/ (root)`, poi **Save**.
5. Dopo 1 o 2 minuti la pagina mostra l'indirizzo dell'app, del tipo `https://TUONOME.github.io/ore-officina/`.

### 6. Installa l'app sugli smartphone

Manda l'indirizzo agli operai e a te.

- **Android (Chrome):** apri il link, menu a tre puntini, **Installa app** (o **Aggiungi a schermata Home**).
- **iPhone (Safari):** apri il link, tocca **Condividi**, poi **Aggiungi alla schermata Home**. Su iPhone deve essere Safari.

### 7. Primo utilizzo

1. Apri l'app, tocca **Accesso titolare** e inserisci il PIN del punto 3.
2. In **Anagrafiche** aggiungi gli operai (nome e PIN personale) e i mezzi per il soccorso stradale.
3. In **Lavori** inserisci i lavori. Pulizia officina e Altre attività sono già presenti.
4. Dai a ogni operaio il suo PIN. Da quel momento può entrare, scegliere il suo nome e lavorare.

---

## Come si usa

**Operaio**

- Sceglie il nome, digita il PIN, cerca il lavoro per codice, targa o codice a barre e preme **Avvia**.
- Con **Pausa** ferma il lavoro e fa partire il tempo di pausa, con **Riprendi** torna sullo stesso lavoro, con **Stop** chiude.
- Sul lavoro in corso scrive ricambi (uno per riga) e note e, se serve, spunta **Soccorso stradale** scegliendo il mezzo. Il soccorso resta legato a quel lavoro e compare nei report.
- Più operai possono lavorare sullo stesso lavoro nello stesso momento. Chi sceglie un lavoro vede chi ci sta già lavorando.
- Se dimentica di fermare il timer, il giorno dopo l'app gli chiede a che ora ha finito.

**Titolare**

- **Report:** in alto "In corso adesso", poi giornaliero o mensile, per persona o per lavoro, con ricambi, note, soccorsi e pause. Le pause non sono contate nelle ore lavorate. Si esporta in CSV (apribile in Excel) o si stampa.
- **Correggi orari:** nel report giornaliero per persona puoi modificare inizio e fine, eliminare un tempo o aggiungerne uno a mano.
- **Lavori** e **Anagrafiche:** crei lavori, chiudi quelli finiti, gestisci operai, PIN e mezzi.

---

## Cose da sapere

- **Serve la rete.** Senza connessione l'app si apre ma timer e azioni non vengono salvati: l'app avvisa. Non c'è coda offline.
- **PIN.** Sono salvati cifrati sul server. Dopo 5 PIN sbagliati l'accesso si blocca per 15 minuti. La sessione dura 12 ore e l'app si richiude dopo 10 minuti in background.
- **Privacy.** Chiunque conosca il link vede i nomi degli operai nella schermata di accesso, ma non può entrare senza PIN. Gli operai collegati vedono i nomi dei colleghi che lavorano sul loro stesso lavoro.
- **Piano gratuito di Supabase.** Il progetto va in pausa dopo circa 7 giorni senza uso (per esempio nelle ferie di agosto). Si riattiva dal pannello Supabase con un clic. Il piano gratuito non include backup automatici: esporta il CSV ogni mese.
- **Fuso orario.** I report giornalieri usano il fuso Europe/Rome.
- **Aggiornare l'app.** Sostituisci i file nel repository GitHub. Gli smartphone ricevono la nuova versione alla successiva apertura con la rete.

## Grafica

Colori e logo sono quelli di CVP (blu `#3681AB`, grigio e bianco). Per cambiare il logo sostituisci il file `icons/logo.png`. Le icone dell'app sono `icons/icon-*.png` e `icons/apple-touch-icon.png`.

## Contenuto della cartella

| File | A cosa serve |
| --- | --- |
| `index.html`, `style.css`, `app.js` | L'app |
| `config.js` | Indirizzo e chiave del tuo Supabase (da compilare) |
| `manifest.webmanifest`, `sw.js`, `icons/` | Rendono l'app installabile |
| `supabase/schema.sql` | Tabelle e funzioni del database |

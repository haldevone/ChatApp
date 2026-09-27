# ChatApp – Säker realtidschat med SignalR

En chattapplikation byggd med ASP.NET Core MVC, SignalR och Identity, med fokus på
säkerhet: privata chattrum med behörighetskontroll, meddelandekryptering
(AES-GCM + ECDH-nyckelutbyte), lösenordshashning och JWT.

## Förutsättningar

- .NET 10 SDK
- Ett verktyg för att köra EF Core-migrationer: `dotnet tool install --global dotnet-ef`

## Köra projektet lokalt

1. Klona repot och stå i mappen där `.sln`-filen ligger.

2. Återställ paket: 
   dotnet restore

3. Sätt en hemlig nyckel för JWT-signering (krävs för att appen ska starta).
   Nyckeln lagras bara lokalt på din dator, aldrig i koden eller i Git:
   
	cd ChatApp
	dotnet user-secrets init
	dotnet user-secrets set "Jwt:Key" "<valfri egen sträng, minst 32 tecken>"
	cd ..

   
4. Skapa databasen (SQLite, skapas automatiskt som en fil i projektmappen):
	cd ChatApp
	dotnet ef database update
	cd ..

	
5. Starta appen:
	cd ChatApp
	dotnet run

	
6. Öppna webbläsaren på adressen som visas i terminalen (https://localhost:7266/).
   Registrera ett konto, logga in, och öppna chattsidan.

## Testa med flera användare samtidigt

Webbläsare delar cookies och lokal lagring mellan flikar/fönster av samma
webbläsare. För att testa flera inloggade användare samtidigt, använd
separata webbläsare eller separata webbläsarprofiler (t.ex. Chrome + Edge +
Firefox, eller flera Chrome-profiler) – annars loggas alla fönster in som
samma senast inloggade användare.

## Köra enhetstester

dotnet test


## Säkerhetsöversikt

- **TLS**: appen körs över HTTPS (self-signed dev-certifikat). Skyddar
  transporten mellan klient och server mot avlyssning/manipulation, men
  skyddar inte mot XSS eller en komprometterad server.
- **Lösenord**: hashas av ASP.NET Core Identity (PBKDF2), aldrig lagrade i
  klartext.
- **Meddelandekryptering**: varje chattrum har en egen AES-GCM-nyckel.
  Nyckeln distribueras till medlemmar via ett ECDH-nyckelutbyte mellan
  rummets ägare och varje inbjuden medlem. Servern lagrar bara krypterad
  text och krypterade nyckelkopior – aldrig klartext eller privata nycklar.
- **Behörighet**: servern kontrollerar medlemskap innan någon släpps in i
  ett rum eller får skicka meddelanden dit, oavsett vad klienten skickar.
- **JWT**: genereras vid inloggning, signerad med en hemlig nyckel som
  aldrig hårdkodas (se steg 3 ovan).

## Kända begränsningar

- Om en användares lokala nyckellagring (webbläsarens IndexedDB) förloras
  (t.ex. rensad webbläsardata, ny enhet), kan tidigare krypterade
  meddelanden i det rummet inte längre dekrypteras av den användaren utan
  att bli ombjuden till rummet på nytt.
- Ingen Content-Security-Policy eller Subresource Integrity är
  implementerad.
- Rummets ägare har ingen serverlagrad nyckelkopia av sig själv och kan
  därför inte återfå åtkomst från en ny enhet utan sin ursprungliga
  privata nyckel.
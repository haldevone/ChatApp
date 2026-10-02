# ChatApp med SignalR
ChatApp med säkerhet i fokus, byggd med ASP.NET Core MVC, SignalR och Identity. Använder sig av privata chatrum med behörighetskontroll, meddelande kryptering, lösenordhashing och JWT.

## Köra projektet lokalt
1.	Klona repot
2.	Sätt en hemlig nyckel för JWT. Nycklen lagras lokalt på datorn 
dotnet user-secrets init 
dotnet user-secrets set "Jwt:Key" "<valfri egen sträng, minst 32 tecken>" 
3.	Updatera databasen (SQlite, skapas automatiskt) dotnet ef database update
4.	Projektet körs via https://localhost:7266/
5.	Registrera Konto, Logga in

## Skapa privat krypterad chat

För att chatta flera användare använd separata webbläsare per användare för att undvika  dubbletter av senast inloggad användare i samma webbläsare.
1.	Skapa nytt rum (du står som rummets ägare)
2.	Bjud in användare via deras epost (användarnamn)
3.	Rummet dyker upp hos användare och kan nu ansluta till chatten

## Köra Enhetstester
dotnet test

## Säkerhetsöversikt
TLS – projektet körs över HTTPS och skyddar transporten mellan klient och server, mot avlysning/manipulation
Lösenord – Hashas via Identity använder sig av (PBKDF2)
Behörighetskontroll – Servern kontrollerar ifall användare är medlem för att bevilja behörighet till rummet/meddelanden.
Meddelandekryptering - Varje chattrum har en egen AES-GCM nickel, distruberat till medlemmarna via EDCH nyckelutbyte, servern lagrar endast krypterade kopior.
JWT – Genereras vid inlogg och signeras med hemlig nyckel

## Kända begränsningar
-	Eftersom del av nyckellagringen sker lokalt så kan vid rensad webbläsare och ny enhet, de tidigare meddelanden ej dekrypteras av den användaren. Användaren måste då bli inbjuden på nytt.
-	Samma orsak som ovan, rummets ägare blir av med rummet, inga privata nycklar sparas i servern.

## Sammarbete med AI
AI har använts för vägledning och förklaring av ECDH AES flödet samt som bollplank av projektet i helhet. Kodgeneration av de mer avancerade tekniska delarna js kryptologik och en del av css.




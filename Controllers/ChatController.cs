using ChatApp.Data;
using ChatApp.Models;
using ChatApp.Services;
using ChatApp.Views.Hubs;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace ChatApp.Controllers
{
    [Authorize]
    public class ChatController : Controller
    {
        private readonly ApplicationDbContext _db;
        private readonly UserManager<ApplicationUser> _userManager;
        private readonly JwtTokenService _jwtTokenService;
        private readonly IHubContext<ChatHub> _hubContext;

        public ChatController(ApplicationDbContext db, UserManager<ApplicationUser> userManager, 
            JwtTokenService jwtTokenService, IHubContext<ChatHub> hubContext)
        {
            _db = db;
            _userManager = userManager;
            _jwtTokenService = jwtTokenService;
            _hubContext = hubContext;
        }

        public async Task<IActionResult> Index()
        {
            var userId = _userManager.GetUserId(User);
            var userName = User.Identity?.Name;

            if (userId == null || userName == null)
                return Challenge();

            var token = _jwtTokenService.GenerateToken(userId, userName);

            Response.Cookies.Append("jwt_token", token, new CookieOptions
            {
                HttpOnly = true,
                Secure = true,
                SameSite = SameSiteMode.Strict,
                Expires = DateTimeOffset.UtcNow.AddHours(2)
            });

            var myRooms = await _db.ChatRoomMembers
                .Where(m => m.UserId == userId)
                .Select(m => m.ChatRoom)
                .ToListAsync();

            var myOwnedRooms = myRooms.Where(r => r.OwnerId == userId).ToList();

            ViewBag.OwnedRooms = myOwnedRooms;

            return View(myRooms);
        }

        [HttpPost]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> CreateRoom(string roomName)
        {
            if (string.IsNullOrWhiteSpace(roomName) || roomName.Length > 50)
                return BadRequest("Felaktig rumsnamn");

            var userId = _userManager.GetUserId(User)!;

            bool alreadyExists = await _db.ChatRooms
                .AnyAsync(r => r.Name.ToLower() == roomName.Trim().ToLower() && r.OwnerId == userId);

            if (alreadyExists)
                return BadRequest("Rummet finns redan.");

            var room = new ChatRoom { Name = roomName.Trim(), OwnerId = userId };
            room.Members.Add(new ChatRoomMember { UserId = userId, ChatRoom = room });

            _db.ChatRooms.Add(room);
            await _db.SaveChangesAsync();

            return Json(new { roomId = room.Id });
        }

        [HttpPost]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> AddMember(int roomId, string userName)
        {
            var userId = _userManager.GetUserId(User);

            var room = await _db.ChatRooms.FindAsync(roomId);

            // Endast rummets ägare får bjuda in medlemmar - avgörande för att
            // "privata rum" faktiskt ska vara privata och inte öppna för alla.
            if (room == null || room.OwnerId != userId)
                return StatusCode(403, "Du äger inte det här rummet.");

            var targetUser = await _userManager.FindByNameAsync(userName);
            if (targetUser == null) return NotFound("Användare finns inte.");

            if (targetUser.Id == room.OwnerId)
                return BadRequest("Ägaren är redan medlem i rummet.");

            bool alreadyMember = await _db.ChatRoomMembers
                .AnyAsync(m => m.ChatRoomId == roomId && m.UserId == targetUser.Id);
            if (alreadyMember) return BadRequest("Redan medlem.");

            _db.ChatRoomMembers.Add(new ChatRoomMember { ChatRoomId = roomId, UserId = targetUser.Id });
            await _db.SaveChangesAsync();

            await _hubContext.Clients.User(targetUser.Id).SendAsync("AddedToRoom", roomId, room.Name);

            return Json(new { userId = targetUser.Id });
        }

        [HttpPost]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> SavePublicKey(string publicKeyJwk)
        {
            var user = await _userManager.GetUserAsync(User);
            
            if (user == null) return Unauthorized();

            user.EcdhPublicKey = publicKeyJwk;
            await _db.SaveChangesAsync();

            return Ok();
        }

        [HttpGet]
        public async Task<IActionResult> GetPublicKey(string userName)
        {
            var user = await _userManager.FindByNameAsync(userName);
            
            if (user?.EcdhPublicKey == null) return NotFound();
            
            return Json(new { publicKey = user.EcdhPublicKey });
        }

        [HttpPost]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> SaveEncryptedRoomKey(int roomId, string targetUserId, string encryptedKey, string iv)
        {
            // Bara ägaren får distribuera rumsnyckeln - förhindrar att någon
            // annan skriver över en medlems krypterade nyckelkopia med skräpdata.
            var userId = _userManager.GetUserId(User);
            var room = await _db.ChatRooms.FindAsync(roomId);
            if (room == null || room.OwnerId != userId) return Forbid();

            var member = await _db.ChatRoomMembers
                .FirstOrDefaultAsync(m => m.ChatRoomId == roomId && m.UserId == targetUserId);
            if (member == null) return NotFound("Medlemmen finns inte i rummet.");

            member.EncryptedRoomKey = encryptedKey;
            member.KeyEncryptionIv = iv;
            await _db.SaveChangesAsync();

            return Ok();
        }

        [HttpGet]
        public async Task<IActionResult> GetMyEncryptedRoomKey(int roomId)
        {
            var userId = _userManager.GetUserId(User);

            var member = await _db.ChatRoomMembers
                .FirstOrDefaultAsync(m => m.ChatRoomId == roomId && m.UserId == userId);
            if (member?.EncryptedRoomKey == null) return NotFound();

            var room = await _db.ChatRooms.FindAsync(roomId);
            var owner = await _userManager.FindByIdAsync(room!.OwnerId);

            return Json(new
            {
                encryptedKey = member.EncryptedRoomKey,
                iv = member.KeyEncryptionIv,
                ownerPublicKey = owner?.EcdhPublicKey
            });
        }

    }
}

using ChatApp.Data;
using ChatApp.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ChatApp.Controllers
{
    [Authorize]
    public class ChatController : Controller
    {
        private readonly ApplicationDbContext _db;
        private readonly UserManager<ApplicationUser> _userManager;

        public ChatController(ApplicationDbContext db, UserManager<ApplicationUser> userManager)
        {
            _db = db;
            _userManager = userManager;
        }

        public async Task<IActionResult> Index()
        {
            var userId = _userManager.GetUserId(User);

            var myRooms = await _db.ChatRoomMembers
                .Where(m => m.UserId == userId)
                .Select(m => m.ChatRoom)
                .ToListAsync();

            return View(myRooms);
        }

        [HttpPost]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> CreateRoom(string roomName)
        {
            if (string.IsNullOrWhiteSpace(roomName) || roomName.Length > 50)
                return BadRequest("Felaktig rumsnamn");

            var userId = _userManager.GetUserId(User)!;

            var room = new ChatRoom { Name = roomName.Trim(), OwnerId = userId };
            room.Members.Add(new ChatRoomMember { UserId = userId, ChatRoom = room });

            _db.ChatRooms.Add(room);
            await _db.SaveChangesAsync();

            return RedirectToAction("Index");
        }

        [HttpPost]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> AddMember(int roomId, string userName)
        {
            var userId = _userManager.GetUserId(User);

            var room = await _db.ChatRooms.FindAsync(roomId);

            if (room == null || room.OwnerId != userId) return Forbid();

            var targetUser = await _userManager.FindByNameAsync(userName);
            if (targetUser == null) return NotFound("Användare finns inte.");

            bool alreadyMember = await _db.ChatRoomMembers
                .AnyAsync(m => m.ChatRoomId == roomId && m.UserId == targetUser.Id);
            if (alreadyMember) return BadRequest("Redan medlem.");

            _db.ChatRoomMembers.Add(new ChatRoomMember { ChatRoomId = roomId, UserId = targetUser.Id });
            await _db.SaveChangesAsync();

            return Ok();
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

    }
}

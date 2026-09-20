using ChatApp.Data;
using ChatApp.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using System.Collections.Concurrent;

namespace ChatApp.Views.Hubs;

[Authorize]
public class ChatHub : Hub
{
    private static readonly ConcurrentDictionary<string, DateTime> _lastTypingCall = new();
    private readonly ApplicationDbContext _db;
    private readonly UserManager<ApplicationUser> _userManager;

    public ChatHub(ApplicationDbContext db, UserManager<ApplicationUser> userManager)
    {
        _db = db;
        _userManager = userManager;
    }
    public async Task JoinGroup(string groupName)
    {
        var userId = _userManager.GetUserId(Context.User);
        
        if (userId == null)
        {
            await Clients.Caller.SendAsync("JoinDenied", groupName);
            return;
        }

        var room = await _db.ChatRooms
            .FirstOrDefaultAsync(r => r.Name.ToLower() == groupName.ToLower());

        bool isMember = room != null && await _db.ChatRoomMembers
            .AnyAsync(m => m.ChatRoomId == room.Id && m.UserId == userId);


        if (!isMember || room == null)
        {
            await Clients.Caller.SendAsync("JoinDenied", groupName);
            return;
        }

        await Groups.AddToGroupAsync(Context.ConnectionId, room.Name.ToLower());

        await Clients.Caller.SendAsync("JoinApproved", room.Name);

        var history = await _db.Messages
            .Where(m => m.ChatRoomId == room!.Id)
            .OrderByDescending(m => m.SentAtUtc)
            .Take(50)
            .Select(m => new { m.SenderName, m.Text, m.SentAtUtc })
            .ToListAsync();

        history.Reverse();

        await Clients.Caller.SendAsync("LoadHistory", history);

        await Clients.OthersInGroup(room.Name.ToLower()).SendAsync("UserJoined", Context.User?.Identity?.Name);
    }

    public async Task LeaveGroup(string groupName)
    {
        var normalizedGroupName = groupName.ToLower();

        await Groups.RemoveFromGroupAsync(Context.ConnectionId, normalizedGroupName);
        await Clients.OthersInGroup(normalizedGroupName).SendAsync("UserLeft", Context.User?.Identity?.Name);
    }

    public async Task SendMessageToGroup(string groupName, string message)
    {
        if(string.IsNullOrWhiteSpace(message) || message.Length > 500)
            return;

        var userId = _userManager.GetUserId(Context.User!)!;

        var senderName = Context.User?.Identity?.Name ?? "Okänd";

        var room = await _db.ChatRooms.FirstOrDefaultAsync(r => r.Name.ToLower() == groupName.ToLower());
        if (room == null) return;

        bool isMember = await _db.ChatRoomMembers.AnyAsync(m => m.ChatRoomId == room.Id && m.UserId == userId);
        if (!isMember) return;

        var newMessage = new Message
        {
            ChatRoomId = room.Id,
            SenderId = userId,
            SenderName = senderName,
            Text = message
        };
        _db.Messages.Add(newMessage);
        await _db.SaveChangesAsync();

        await Clients.Group(room.Name.ToLower()).SendAsync("ReceiveMessage", senderName, message, newMessage.SentAtUtc);
    }

    public async Task NotifyTyping(string groupName)
    {
        var now = DateTime.UtcNow;
        var normalizedGroupName = groupName.ToLower();
        if (_lastTypingCall.TryGetValue(Context.ConnectionId, out var lastCall) && (now - lastCall).TotalMilliseconds < 1000)
            return;

        _lastTypingCall[Context.ConnectionId] = now;

        await Clients.OthersInGroup(normalizedGroupName).SendAsync("UserTyping", Context.User?.Identity?.Name);
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        
        _lastTypingCall.TryRemove(Context.ConnectionId, out _);
        await base.OnDisconnectedAsync(exception);
    }

}

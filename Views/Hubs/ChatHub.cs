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

        var room = await _db.ChatRooms
            .FirstOrDefaultAsync(r => r.Name == groupName);

        bool isMember = room != null && await _db.ChatRoomMembers
            .AnyAsync(m => m.ChatRoomId == room.Id && m.UserId == userId);


        if (!isMember)
        {
            await Clients.Caller.SendAsync("JoinDenied", groupName);
            return;
        }

        await Groups.AddToGroupAsync(Context.ConnectionId, groupName);

        await Clients.Caller.SendAsync("JoinApproved", groupName);

        var history = await _db.Messages
            .Where(m => m.ChatRoomId == room.Id)
            .OrderBy(m => m.SentAtUtc)
            .TakeLast(50)
            .Select(m => new { m.SenderName, m.Text, m.SentAtUtc })
            .ToListAsync();

        await Clients.Caller.SendAsync("LoadHistory", history);

        await Clients.OthersInGroup(groupName).SendAsync("UserJoined", Context.User?.Identity?.Name);
    }

    public async Task LeaveGroup(string groupName)
    {
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, groupName);
        await Clients.OthersInGroup(groupName).SendAsync("UserLeft", Context.User?.Identity?.Name);
    }

    public async Task SendMessageToGroup(string groupName, string message)
    {
        if(string.IsNullOrWhiteSpace(message) || message.Length > 500)
            return;

        var userId = _userManager.GetUserId(Context.User)!;
        var senderName = Context.User?.Identity?.Name ?? "Okänd";

        var room = await _db.ChatRooms.FirstOrDefaultAsync(r => r.Name == groupName);
        if (room == null) return;

        bool isMember = await _db.ChatRoomMembers.AnyAsync(m => m.ChatRoomId == room.Id && m.UserId == userId);
        if (!isMember) return;

        _db.Messages.Add(new Message
        {
            ChatRoomId = room.Id,
            SenderId = userId,
            SenderName = senderName,
            Text = message
        });
        await _db.SaveChangesAsync();

        await Clients.Group(groupName).SendAsync("ReceiveMessage", senderName, message);
    }

    public async Task NotifyTyping(string groupName)
    {
        var now = DateTime.UtcNow;
        if (_lastTypingCall.TryGetValue(Context.ConnectionId, out var lastCall) && (now - lastCall).TotalMilliseconds < 1000)
            return;

        _lastTypingCall[Context.ConnectionId] = now;

        await Clients.OthersInGroup(groupName).SendAsync("UserTyping", Context.User?.Identity?.Name);
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        
        _lastTypingCall.TryRemove(Context.ConnectionId, out _);
        await base.OnDisconnectedAsync(exception);
    }

}

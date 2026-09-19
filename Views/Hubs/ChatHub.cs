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

        bool isMember = await _db.ChatRoomMembers
            .Include(m => m.ChatRoom)
            .AnyAsync(m => m.UserId == userId && m.ChatRoom.Name == groupName);

        if (!isMember)
        {
            await Clients.Caller.SendAsync("JoinDenied", groupName);
            return;
        }

        await Groups.AddToGroupAsync(Context.ConnectionId, groupName);
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

        await Clients.Group(groupName).SendAsync("ReceiveMessage", Context.User?.Identity?.Name, message);
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

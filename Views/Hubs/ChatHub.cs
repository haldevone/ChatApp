using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using System.Collections.Concurrent;

namespace ChatApp.Views.Hubs;

[Authorize]
public class ChatHub : Hub
{
    private static readonly ConcurrentDictionary<string, DateTime> _lastTypingCall = new();

    public async Task JoinGroup(string groupName)
    {
        groupName = groupName.Trim();
        if (string.IsNullOrWhiteSpace(groupName) || groupName.Length > 50)
            return;

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

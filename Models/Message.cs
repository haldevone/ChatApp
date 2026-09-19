namespace ChatApp.Models;

public class Message
{
    public int Id { get; set; }
    public int ChatRoomId { get; set; }
    public ChatRoom ChatRoom { get; set; } = null!;

    public string SenderId { get; set; } = string.Empty;
    public string SenderName { get; set; } = string.Empty;
    public string Text { get; set; } = string.Empty;
    public DateTime SentAtUtc { get; set; } = DateTime.UtcNow;
}

namespace ChatApp.Models;

public class ChatRoomMember
{
    public int Id { get; set; }
    public string UserId { get; set; } = string.Empty;
    public int ChatRoomId { get; set; }
    public ChatRoom ChatRoom { get; set; } = null!;


    public string? EncryptedRoomKey { get; set; }
    public string? KeyEncryptionIv { get; set; }
}

using ChatApp.Models;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace ChatApp.Data;

public class ApplicationDbContext(DbContextOptions<ApplicationDbContext> options) : IdentityDbContext<ApplicationUser>(options)
{

    public DbSet<ChatRoom> ChatRooms { get; set; } = null!;
    public DbSet<ChatRoomMember> ChatRoomMembers { get; set; } = null!;
    public DbSet<Message> Messages { get; set; } = null!;


    override protected void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<ChatRoomMember>()
            .HasOne(m => m.ChatRoom)
            .WithMany(r => r.Members)
            .HasForeignKey(m => m.ChatRoomId);

        modelBuilder.Entity<Message>()
            .HasOne(m => m.ChatRoom)
            .WithMany(r => r.Messages)
            .HasForeignKey(m => m.ChatRoomId);
    }

}

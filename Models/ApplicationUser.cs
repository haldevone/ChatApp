using Microsoft.AspNetCore.Identity;

namespace ChatApp.Models;

public class ApplicationUser : IdentityUser
{
    public string? DisplayName { get; set; }
}

namespace SpearTips.Models;

public class FavouriteLocation
{
    public string Id      { get; set; } = Guid.NewGuid().ToString("N")[..8];
    public string Name    { get; set; } = string.Empty;
    public double Lat     { get; set; }
    public double Lng     { get; set; }
    public string? Note   { get; set; }
    public DateTime Added { get; set; } = DateTime.UtcNow;
}
